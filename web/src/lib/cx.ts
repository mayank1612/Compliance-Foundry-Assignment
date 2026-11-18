/** Join class names, skipping falsy ones: cx('a', isOn && 'b') → 'a b' or 'a'. */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
