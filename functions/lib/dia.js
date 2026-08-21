// mesma noção de "dia" do app (fuso de Brasília), calculada no lado do servidor.
function todayKeyBR(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(date);
}

module.exports = { todayKeyBR };
