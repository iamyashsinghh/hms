// Owned by the "pharmacy" workstream; screens go in src/app/(app)/pharmacy/.
import { AlarmClock, ClipboardList, PackagePlus, Pill, ReceiptText, ShoppingCart, Store, Warehouse } from 'lucide-react';
import type { NavItem } from '../types';

export const nav: NavItem[] = [
  { label: 'Rx queue', href: '/pharmacy/queue', permission: 'pharmacy.prescription.read', icon: ClipboardList },
  { label: 'New sale', href: '/pharmacy/sales/new', permission: 'pharmacy.sale.create', icon: ShoppingCart },
  { label: 'Sales', href: '/pharmacy/sales', permission: 'pharmacy.sale.read', icon: ReceiptText },
  { label: 'Stock', href: '/pharmacy', permission: 'pharmacy.stock.read', icon: Warehouse },
  { label: 'Receive stock', href: '/pharmacy/receive', permission: 'pharmacy.stock.receive', icon: PackagePlus },
  { label: 'Expiry', href: '/pharmacy/expiry', permission: 'pharmacy.stock.read', icon: AlarmClock },
  { label: 'Drug master', href: '/pharmacy/items', permission: 'pharmacy.item.read', icon: Pill },
  { label: 'Stores', href: '/pharmacy/stores', permission: 'pharmacy.store.manage', icon: Store },
];
