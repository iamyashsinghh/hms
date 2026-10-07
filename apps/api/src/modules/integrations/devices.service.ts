import { Injectable } from '@nestjs/common';
import { iso, type Tx } from '@hms/db';
import { integrations, type Paginated } from '@hms/shared';
import { currentContext } from '../../common/context/request-context';
import { DbService } from '../../common/db/db.service';
import { conflict, notFound } from '../../common/errors/errors';
import { OutboxService } from '../../common/events/outbox.service';
import { buildAck, Hl7Error, parseOru, peekHeader } from './hl7';
import { IntegrationsRepository, type DeviceMessageRow, type LabDeviceRow } from './integrations.repository';

/**
 * Lab machine interfaces. Machines (or a middleware box next to them) post HL7 v2 ORU^R01 results;
 * each accepted message is stored and published as `integrations.device.results_received` for the
 * lab module to match by sample barcode.
 */
@Injectable()
export class DevicesService {
  constructor(
    private readonly db: DbService,
    private readonly repo: IntegrationsRepository,
    private readonly outbox: OutboxService,
  ) {}

  list(): Promise<integrations.LabDevice[]> {
    return this.db.tx(async (tx) => (await this.repo.devices(tx)).map(deviceDto));
  }

  create(input: integrations.DeviceInput): Promise<integrations.LabDevice> {
    const d = integrations.deviceInputSchema.parse(input);
    const userId = currentContext()?.userId ?? null;
    return this.db.tx(async (tx) => {
      if (await this.repo.deviceByCode(tx, d.code)) throw conflict('device_code_taken', `A machine with code ${d.code} already exists`);
      const row = await this.repo.insertDevice(tx, {
        code: d.code,
        name: d.name,
        model: d.model || null,
        protocol: d.protocol,
        facilityId: d.facilityId ?? null,
        isActive: d.isActive,
        createdBy: userId,
        updatedBy: userId,
      });
      return deviceDto(row);
    });
  }

  update(id: string, input: integrations.UpdateDevice): Promise<integrations.LabDevice> {
    const d = integrations.updateDeviceSchema.parse(input);
    return this.db.tx(async (tx) => {
      const row = await this.repo.updateDevice(tx, id, {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.model !== undefined ? { model: d.model || null } : {}),
        ...(d.protocol !== undefined ? { protocol: d.protocol } : {}),
        ...(d.facilityId !== undefined ? { facilityId: d.facilityId } : {}),
        ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
        updatedBy: currentContext()?.userId ?? null,
      });
      if (!row) throw notFound('Lab machine');
      return deviceDto(row);
    });
  }

  messages(query: unknown): Promise<Paginated<integrations.DeviceMessage>> {
    const q = integrations.deviceMessageQuerySchema.parse(query);
    return this.db.tx(async (tx) => {
      const { items, total } = await this.repo.deviceMessages(tx, q);
      const codes = new Map((await this.repo.devices(tx)).map((d) => [d.id, d.code]));
      return { items: items.map((m) => messageDto(m, codes.get(m.deviceId) ?? '')), page: q.page, pageSize: q.pageSize, total };
    });
  }

  message(id: string): Promise<integrations.DeviceMessage> {
    return this.db.tx(async (tx) => {
      const m = await this.repo.deviceMessage(tx, id);
      if (!m) throw notFound('Message');
      return messageDto(m, (await this.repo.device(tx, m.deviceId))?.code ?? '');
    });
  }

  /** From the public API (device code) or the staff test screen (device id). */
  receive(device: { code: string } | { id: string }, raw: string): Promise<integrations.Hl7AckResponse> {
    return this.db.tx(async (tx) => {
      const dev = 'id' in device ? await this.repo.device(tx, device.id) : await this.repo.deviceByCode(tx, device.code.toUpperCase());
      if (!dev) throw notFound('Lab machine');
      if (!dev.isActive) throw conflict('device_inactive', `Lab machine ${dev.code} is switched off`);
      return this.ingest(tx, dev, raw);
    });
  }

  private async ingest(tx: Tx, dev: LabDeviceRow, raw: string): Promise<integrations.Hl7AckResponse> {
    const header = peekHeader(raw);
    let parsed: ReturnType<typeof parseOru> | null = null;
    let error: string | null = null;
    try {
      parsed = parseOru(raw);
    } catch (e) {
      if (!(e instanceof Hl7Error)) throw e;
      error = e.message;
    }

    if (parsed?.controlId) {
      const previous = await this.repo.deviceMessageByControl(tx, dev.id, parsed.controlId);
      if (previous) return ackResponse(previous, header, true);
    }

    const row = await this.repo.insertDeviceMessage(tx, {
      deviceId: dev.id,
      messageType: parsed?.messageType ?? null,
      controlId: parsed?.controlId ?? header.controlId,
      sampleId: parsed?.sampleId ?? null,
      patientRef: parsed?.patientRef ?? null,
      results: parsed?.results ?? [],
      status: parsed ? 'accepted' : 'rejected',
      error,
      raw,
    });
    if (!row) {
      // Lost a race with the same message arriving twice at once.
      const previous = await this.repo.deviceMessageByControl(tx, dev.id, parsed!.controlId!);
      return ackResponse(previous!, header, true);
    }
    await this.repo.updateDevice(tx, dev.id, { lastMessageAt: row.receivedAt });
    if (parsed) {
      const event: integrations.DeviceResultsReceivedEvent = {
        messageId: row.id,
        deviceId: dev.id,
        deviceCode: dev.code,
        sampleId: row.sampleId,
        patientRef: row.patientRef,
        results: parsed.results,
      };
      await this.outbox.publish(tx, 'integrations.device.results_received', { ...event });
    }
    return ackResponse(row, header, false);
  }
}

function ackResponse(m: DeviceMessageRow, header: ReturnType<typeof peekHeader>, duplicate: boolean): integrations.Hl7AckResponse {
  const ok = m.status === 'accepted';
  return {
    messageId: m.id,
    status: m.status as integrations.DeviceMessageStatus,
    ack: buildAck({ controlId: m.controlId ?? header.controlId, sendingApp: header.sendingApp, sendingFacility: header.sendingFacility, ok, error: m.error }),
    resultCount: (m.results as unknown[]).length,
    duplicate,
    error: m.error,
  };
}

function deviceDto(r: LabDeviceRow): integrations.LabDevice {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    model: r.model,
    protocol: r.protocol as integrations.DeviceProtocol,
    facilityId: r.facilityId,
    isActive: r.isActive,
    lastMessageAt: iso(r.lastMessageAt),
    createdAt: iso(r.createdAt),
  };
}

function messageDto(r: DeviceMessageRow, deviceCode: string): integrations.DeviceMessage {
  return {
    id: r.id,
    deviceId: r.deviceId,
    deviceCode,
    messageType: r.messageType,
    controlId: r.controlId,
    sampleId: r.sampleId,
    patientRef: r.patientRef,
    results: r.results as integrations.DeviceResult[],
    status: r.status as integrations.DeviceMessageStatus,
    error: r.error,
    raw: r.raw,
    receivedAt: iso(r.receivedAt),
  };
}
