import {tr} from '../../i18n/korean.ts';

/** A select's first line while nothing is chosen (11-02: what the user adds chooses nothing for them). */
export function Unchosen() {
  return (
    <option value="" disabled>
      {tr('선택…')}
    </option>
  );
}
