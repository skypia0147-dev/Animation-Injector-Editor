import {DetailRow} from './ui/details/DetailRow';
export function Field({label, children, hint}: {label: string; children: React.ReactNode; hint?: string}) {
  return (
    <DetailRow label={label} hint={hint}>
      {children}
    </DetailRow>
  );
}
