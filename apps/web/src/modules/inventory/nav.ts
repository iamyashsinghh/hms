// Owned by the "inventory" workstream; screens go in src/app/(app)/inventory/.
import { Boxes, ClipboardCheck, ClipboardList, ShoppingBag, Truck, Warehouse } from 'lucide-react';
import type { NavItem } from '../types';

export const nav: NavItem[] = [
  { label: 'Store stock', href: '/inventory/stock', permission: 'pharmacy.stock.read', icon: Warehouse },
  { label: 'Indents', href: '/inventory/indents', permission: 'inventory.indent.read', icon: ClipboardList },
  { label: 'Requisitions', href: '/inventory/requisitions', permission: 'inventory.purchase.read', icon: ClipboardCheck },
  { label: 'Purchase orders', href: '/inventory/purchase-orders', permission: 'inventory.purchase.read', icon: ShoppingBag },
  { label: 'Goods received', href: '/inventory/grns', permission: 'inventory.purchase.read', icon: Boxes },
  { label: 'Vendors', href: '/inventory/vendors', permission: 'inventory.vendor.read', icon: Truck },
];
