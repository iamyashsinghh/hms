import { redirect } from 'next/navigation';

export default function PharmacyHome() {
  redirect('/pharmacy/stock');
}
