import { Transform } from 'class-transformer';

/** Trims a string before validation (pasted emails often carry spaces). */
export const Trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
