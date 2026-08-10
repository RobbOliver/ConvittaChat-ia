import { runMarmitariaAssistant } from '../core/chat.js';

/**
 * Actually calls OpenRouter with the assembled prompt — requires a real OPENROUTER_API_KEY in
 * .env. Use `npm run preview` first to review the prompt with no cost/API call; use this once
 * you're ready to see a real model response.
 *
 * Usage: npm run send -- "sua pergunta de teste aqui"
 */
const userMessage = process.argv.slice(2).join(' ') || 'Quanto custa a marmita M e vocês entregam no Jardim das Flores?';

console.log('Enviando ao OpenRouter...\n');
const result = await runMarmitariaAssistant(userMessage);

console.log('='.repeat(72));
console.log(`MODELO: ${result.model}`);
console.log('='.repeat(72));
console.log('RESPOSTA:');
console.log(result.reply);
console.log('='.repeat(72));

if (result.blocked) {
  console.log(`BLOQUEADA ANTES DE CHEGAR AO MODELO: ${result.blockReason}`);
}
if (result.warnings.length > 0) {
  console.log('AVISOS:');
  for (const warning of result.warnings) console.log(`  - ${warning}`);
} else {
  console.log('Nenhum aviso de segurança/alucinação.');
}
