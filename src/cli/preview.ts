import { buildBusinessContext } from '../knowledge/marmitaria.js';
import { assemblePrompt } from '../core/assemblePrompt.js';
import { sanitizeUserInput } from '../security/inputSanitizer.js';

/**
 * Builds the exact prompt that WOULD be sent to OpenRouter and prints it — no API call, no
 * OPENROUTER_API_KEY required. This is the "compose and review before sending" tool: run it after
 * editing the system prompt or the knowledge base to see precisely what the model will receive,
 * catch an accidentally-blocked message, or sanity-check the sandwich reminder placement.
 *
 * Usage: npm run preview -- "sua pergunta de teste aqui"
 */
const userMessage = process.argv.slice(2).join(' ') || 'Quanto custa a marmita M e vocês entregam no Jardim das Flores?';

const { sanitized, flags, blocked, blockReason } = sanitizeUserInput(userMessage);

console.log('='.repeat(72));
console.log('MENSAGEM ORIGINAL:');
console.log(userMessage);
console.log('='.repeat(72));

if (flags.length > 0) {
  console.log('AVISOS DO SANITIZER:');
  for (const flag of flags) console.log(`  - ${flag}`);
  console.log('='.repeat(72));
}

if (blocked) {
  console.log(`BLOQUEADA: ${blockReason}`);
  process.exit(0);
}

const messages = assemblePrompt({ businessContext: buildBusinessContext(), userMessage: sanitized });

console.log('PROMPT COMPLETO QUE SERIA ENVIADO AO OPENROUTER:\n');
for (const message of messages) {
  console.log(`--- role: ${message.role} ---`);
  console.log(typeof message.content === 'string' ? message.content : JSON.stringify(message.content, null, 2));
  console.log();
}
