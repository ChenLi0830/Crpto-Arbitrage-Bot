class MinorError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MinorError';
  }
}

class MajorError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MajorError';
  }
}

module.exports = {MinorError, MajorError}
