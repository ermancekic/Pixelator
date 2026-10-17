/** An expected, user-facing error with a stable code; free of Node dependencies so the editor can share it. */
export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
