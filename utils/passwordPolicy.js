const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 200;

const PASSWORD_REQUIREMENTS = Object.freeze({
  lowercase: /[a-z]/,
  uppercase: /[A-Z]/,
  digit: /\d/,
  symbol: /[^A-Za-z0-9\s]/,
});

function validateNewUserPassword(value) {
  const password = typeof value === 'string' ? value : '';
  const missing = [];

  if (password.length < PASSWORD_MIN_LENGTH) missing.push('minimum_length');
  if (password.length > PASSWORD_MAX_LENGTH) missing.push('maximum_length');
  for (const [requirement, pattern] of Object.entries(PASSWORD_REQUIREMENTS)) {
    if (!pattern.test(password)) missing.push(requirement);
  }

  return {
    valid: missing.length === 0,
    missing,
    message: `A senha deve ter entre ${PASSWORD_MIN_LENGTH} e ${PASSWORD_MAX_LENGTH} caracteres e incluir letra minúscula, letra maiúscula, número e símbolo.`,
  };
}

module.exports = {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  validateNewUserPassword,
};
