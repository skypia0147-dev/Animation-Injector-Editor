/** An error as the UI shows it: a thrown Error's message (String() would put 「Error: 」 before it, in English), or
 *  the value itself (the backend's errors are strings). */
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
