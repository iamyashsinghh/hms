import { PortalList } from '@/screens/PortalList';

export default function MyRecords() {
  return (
    <PortalList
      kinds={[
        { kind: 'prescriptions', title: 'Prescriptions', empty: 'No prescriptions yet' },
        { kind: 'bills', title: 'Bills', empty: 'No bills yet' },
      ]}
      emptyIcon="document-text-outline"
    />
  );
}
