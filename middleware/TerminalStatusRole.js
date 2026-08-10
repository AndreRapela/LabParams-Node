const roleFromTable = require('./RoleFromTable');

function terminalStatusRole({
  field = 'status',
  terminalStatuses = [],
  eventAliases = {},
} = {}) {
  const managerOnly = roleFromTable('Gestor');
  const terminals = new Set(terminalStatuses);

  return (req, res, next) => {
    const eventType = String(req.body?.tipo_evento ?? '');
    const requestedStatus = eventAliases[eventType] || req.body?.[field];
    if (!terminals.has(requestedStatus)) return next();
    return managerOnly(req, res, next);
  };
}

module.exports = terminalStatusRole;
