'use client';

import * as React from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { api, errorMessage } from '@/lib/api';
import { useAuth, usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { MODE_LABELS, amountInWords, formatDateTime, formatINR } from '@/modules/billing/ui';

export default function PrintInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('billing.invoice.read');
  const { facility } = useAuth();
  const { data: inv, error } = useQuery({ queryKey: ['billing', 'invoices', id], queryFn: () => api.billing.invoices.get(id), enabled: canRead });
  const { data: settings } = useQuery({ queryKey: ['billing', 'settings'], queryFn: () => api.billing.settings.get(), enabled: canRead, retry: false });

  if (!canRead) return <NoAccess />;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  if (!inv) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const hasTax = inv.taxTotal > 0;

  return (
    <>
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #invoice-print, #invoice-print * { visibility: visible !important; }
        #invoice-print { position: absolute; left: 0; top: 0; width: 100%; padding: 0; box-shadow: none; border: 0; }
        @page { size: A4; margin: 12mm; }
      }`}</style>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={`/billing/invoices/${id}`} className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3' })}>
          <ArrowLeft /> Back to bill
        </Link>
        <Button onClick={() => window.print()}>
          <Printer /> Print
        </Button>
      </div>

      <div id="invoice-print" className="mx-auto max-w-3xl rounded-lg border bg-white p-8 text-[13px] leading-snug text-black shadow-sm">
        <header className="flex items-start justify-between border-b pb-4">
          <div>
            <h1 className="text-xl font-bold">{inv.sellerName ?? settings?.legalName ?? facility?.name ?? 'Hospital'}</h1>
            {settings?.address && <p className="whitespace-pre-line">{settings.address}</p>}
            {settings?.phone && <p>Phone: {settings.phone}</p>}
            {(inv.sellerGstin ?? settings?.gstin) && <p>GSTIN: {inv.sellerGstin ?? settings?.gstin}</p>}
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold uppercase tracking-wide">{hasTax ? 'Tax Invoice' : 'Bill of Supply'}</p>
            <p>
              No: <span className="font-mono font-semibold">{inv.number}</span>
            </p>
            <p>Date: {formatDate(inv.invoiceDate)}</p>
            {inv.status === 'cancelled' && <p className="mt-1 font-bold text-red-600">CANCELLED</p>}
          </div>
        </header>

        <section className="grid grid-cols-2 gap-4 border-b py-3">
          <div>
            <p className="text-xs uppercase text-gray-500">Billed to</p>
            <p className="font-semibold">{inv.patientName}</p>
            <p>UHID: {inv.patientUhid}</p>
            {inv.patientMobile && <p>Mobile: {inv.patientMobile}</p>}
            {inv.buyerGstin && <p>GSTIN: {inv.buyerGstin}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs uppercase text-gray-500">Supply</p>
            <p>{inv.supplyType === 'intra' ? 'Intra-state' : 'Inter-state'}</p>
          </div>
        </section>

        <table className="mt-3 w-full border-collapse">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-gray-600">
              <th className="py-1.5">#</th>
              <th>Description</th>
              <th>HSN/SAC</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Rate</th>
              <th className="text-right">Disc.</th>
              <th className="text-right">Taxable</th>
              <th className="text-right">GST</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.id} className="border-b align-top [&>td]:py-1.5">
                <td>{l.lineNo}</td>
                <td>{l.description}</td>
                <td>{l.hsnSac ?? ''}</td>
                <td className="text-right">{l.qty}</td>
                <td className="text-right">{l.unitPrice.toFixed(2)}</td>
                <td className="text-right">{l.discount ? l.discount.toFixed(2) : ''}</td>
                <td className="text-right">{l.taxableAmount.toFixed(2)}</td>
                <td className="text-right">
                  {l.taxRate}%<br />
                  {l.taxAmount.toFixed(2)}
                </td>
                <td className="text-right">{l.total.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="mt-4 flex justify-between gap-6">
          <div className="flex-1 space-y-2">
            <p>
              <span className="text-xs uppercase text-gray-500">Amount in words</span>
              <br />
              {amountInWords(inv.total)}
            </p>
            {inv.payments.length > 0 && (
              <div>
                <p className="text-xs uppercase text-gray-500">Payments</p>
                {inv.payments.map((p) => (
                  <p key={p.id}>
                    {p.number} · {p.kind === 'refund' ? 'Refund' : MODE_LABELS[p.mode]} · {formatDateTime(p.receivedAt)} · {p.kind === 'refund' ? '−' : ''}
                    {formatINR(p.amount)}
                  </p>
                ))}
              </div>
            )}
            {inv.notes && <p>Note: {inv.notes}</p>}
            {inv.upiLink && (
              <div className="flex items-center gap-3 pt-2">
                <QRCodeSVG value={inv.upiLink} size={96} />
                <span>Scan to pay {formatINR(inv.balance)} by UPI</span>
              </div>
            )}
          </div>
          <table className="w-64 text-right">
            <tbody>
              <TotalRow label="Gross" value={inv.subtotal} />
              {inv.discountTotal > 0 && <TotalRow label="Discount" value={-inv.discountTotal} />}
              <TotalRow label="Taxable value" value={inv.taxableTotal} />
              {inv.supplyType === 'intra' ? (
                <>
                  <TotalRow label="CGST" value={inv.cgstTotal} />
                  <TotalRow label="SGST" value={inv.sgstTotal} />
                </>
              ) : (
                <TotalRow label="IGST" value={inv.igstTotal} />
              )}
              {inv.roundOff !== 0 && <TotalRow label="Round off" value={inv.roundOff} />}
              <tr className="border-t text-base font-bold">
                <td className="py-1 text-left">Total</td>
                <td>{formatINR(inv.total)}</td>
              </tr>
              <TotalRow label="Paid" value={inv.paidAmount} />
              {inv.creditedAmount > 0 && <TotalRow label="Credit notes" value={inv.creditedAmount} />}
              <tr className="font-semibold">
                <td className="text-left">Balance</td>
                <td>{formatINR(inv.balance)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <footer className="mt-8 flex items-end justify-between border-t pt-3 text-xs text-gray-600">
          <p className="max-w-md whitespace-pre-line">{settings?.invoiceFooter ?? 'Thank you. Get well soon.'}</p>
          <p className="text-right">
            <br />
            Authorised signatory
          </p>
        </footer>
      </div>
    </>
  );
}

function TotalRow({ label, value }: { label: string; value: number }) {
  return (
    <tr>
      <td className="text-left text-gray-600">{label}</td>
      <td>{formatINR(value)}</td>
    </tr>
  );
}
