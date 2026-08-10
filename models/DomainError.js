class DomainError extends Error {
  constructor(message, statusCode = 400, code = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'DomainError';
    this.statusCode = statusCode;
    this.code = code;
  }

  static notFound(message) {
    return new DomainError(message, 404, 'NOT_FOUND');
  }

  static conflict(message) {
    return new DomainError(message, 409, 'CONFLICT');
  }
}

module.exports = DomainError;
