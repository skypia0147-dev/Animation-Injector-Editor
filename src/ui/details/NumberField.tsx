import {NumberInput} from './NumberInput.tsx';

// A details number box (docs/mockup-layout-fixes ①): the box alone, so it lines up with the menus beside it. The
// wheel steps it while it has the cursor (NumberInput).
export function NumberField({
  value,
  change,
  label,
  min = 0,
  max = 600,
  step = 0.05,
}: {
  value: number;
  change: (v: number) => void;
  label: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className="number-control">
      <NumberInput aria-label={label} min={min} max={max} step={step} value={value} change={change} />
    </div>
  );
}
