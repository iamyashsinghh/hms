'use client';

import type { emr } from '@hms/shared';

const PAGE: Record<emr.PrintHeader['template']['paperSize'], string> = { A4: 'A4', A5: 'A5', thermal_80mm: '80mm auto' };
const WIDTH: Record<emr.PrintHeader['template']['paperSize'], string> = { A4: '210mm', A5: '148mm', thermal_80mm: '80mm' };

/** Hides the app shell when printing so only #print-area is on paper, sized by the hospital's print template. */
export function PrintStyles({ template }: { template?: emr.PrintHeader['template'] }) {
  const size = template ? PAGE[template.paperSize] : 'A4';
  const top = template?.marginTopMm ?? 10;
  const bottom = template?.marginBottomMm ?? 10;
  return (
    <style>{`
      @media print {
        @page { size: ${size}; margin: ${top}mm 10mm ${bottom}mm 10mm; }
        body * { visibility: hidden !important; }
        #print-area, #print-area * { visibility: visible !important; }
        #print-area { position: absolute; inset: 0 auto auto 0; width: 100%; max-width: none; padding: 0; box-shadow: none; border: 0; }
      }
    `}</style>
  );
}

export const paperWidth = (h?: emr.PrintHeader) => WIDTH[h?.template.paperSize ?? 'A4'];

/** Hospital letterhead and the doctor's credentials, from Setup. */
export function Letterhead({ header, fallbackName, showDoctor = true }: { header: emr.PrintHeader; fallbackName?: string | null; showDoctor?: boolean }) {
  const { hospital: h, template: t, doctor: d } = header;
  const accent = h.letterhead?.accentColor ?? '#000';
  const address = [h.address?.line1, h.address?.line2, h.address?.city, h.address?.state, h.address?.pincode].filter(Boolean).join(', ');
  return (
    <header className="border-b-2 pb-3" style={{ borderColor: accent }}>
      {t.showLetterhead && (
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {t.showLogo && h.logoUrl && <img src={h.logoUrl} alt="" className="h-14 w-14 object-contain" />}
            <div>
              <h1 className="text-xl font-bold" style={{ color: accent }}>
                {h.displayName}
              </h1>
              {h.letterhead?.tagline && <p className="text-xs italic">{h.letterhead.tagline}</p>}
              {address && <p className="text-xs">{address}</p>}
              <p className="text-xs">{[h.phone, h.email, h.website].filter(Boolean).join(' · ')}</p>
              {h.registrationNo && <p className="text-[10px]">Reg. No: {h.registrationNo}</p>}
            </div>
          </div>
          {showDoctor && (
            <div className="text-right">
              <p className="text-base font-semibold">{d?.name ?? fallbackName}</p>
              {d?.qualification && <p className="text-xs">{d.qualification}</p>}
              {(d?.specialization || d?.departmentName) && <p className="text-xs">{d.specialization ?? d.departmentName}</p>}
              {d?.registrationNo && (
                <p className="text-[10px]">
                  Reg. No: {d.registrationNo}
                  {d.registrationCouncil ? ` (${d.registrationCouncil})` : ''}
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {(t.headerText || h.letterhead?.headerNote) && <p className="mt-1 text-xs">{t.headerText ?? h.letterhead?.headerNote}</p>}
    </header>
  );
}

export function PrintFooter({ header }: { header: emr.PrintHeader }) {
  const text = header.template.footerText ?? header.hospital.letterhead?.footerNote;
  return text ? <p className="mt-6 border-t pt-2 text-center text-[10px]">{text}</p> : null;
}

export function Signature({ header, fallbackName, signedAt }: { header: emr.PrintHeader; fallbackName?: string | null; signedAt?: string | null }) {
  const d = header.doctor;
  return (
    <div className="text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {d?.signatureUrl ? <img src={d.signatureUrl} alt="" className="mx-auto h-12 object-contain" /> : <div className="h-10" />}
      <p className="border-t border-black px-6 pt-1 font-semibold">{d?.name ?? fallbackName}</p>
      {d?.registrationNo && <p className="text-[10px]">Reg. No: {d.registrationNo}</p>}
      {signedAt && <p className="text-[10px]">Digitally signed {new Date(signedAt).toLocaleString('en-IN')}</p>}
    </div>
  );
}
