/** Ошибка синхронизации с понятным пользователю сообщением. code: load | popup | cancelled | network | drive | auth. */
export class SyncError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SyncError";
    this.code = code;
  }
}

/** Google отклонил токен (просрочен или отозван): нужно войти заново. */
export class DriveAuthError extends SyncError {
  constructor(message = "Сеанс Google истёк. Войдите снова.") {
    super("auth", message);
    this.name = "DriveAuthError";
  }
}
