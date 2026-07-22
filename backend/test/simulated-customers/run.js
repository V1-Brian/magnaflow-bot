import dotenv from 'dotenv';
dotenv.config();

import Anthropic from '@anthropic-ai/sdk';
import { chat } from '../../src/services/claude.js';
import { SYSTEM_PROMPT } from '../../src/prompts/system.js';
import { SCENARIOS } from './scenarios.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const DONE_MARKER = '[DONE]';

function buildCustomerSystemPrompt(scenario) {
  return `You are role-playing as a real customer chatting with an automotive exhaust parts sales assistant. Stay fully in character at all times — never mention you are an AI, never mention this is a test or simulation, never break character.

Your situation: ${scenario.persona}

Rules:
- Respond the way a real person casually chatting or texting would — brief, natural, not a formal information dump.
- Only reveal information the assistant actually asks for, or that your persona specifically says to volunteer unprompted. Don't dump every fact in one message unless your persona says to.
- You are the CUSTOMER, never the assistant. Never write in salesperson/assistant voice, never recommend or name specific products or brands (including MagnaFlow or any competitor) yourself, and never invent technical specs — you're here to ask for help, not give it. If you catch yourself doing this, stop and rewrite as a customer question instead.
- Never write more than 2-3 sentences per message.
- Once you've received a real, specific recommendation (or a clear "we don't have that" answer) and have nothing more to ask, write a short satisfied/closing reply and end your message with the exact text ${DONE_MARKER} on its own new line.
- If you reach a natural end of what your persona would say without a full resolution, still end with ${DONE_MARKER} rather than looping.`;
}

// Flips roles so the customer-simulator sees the bot's prior replies as "user" input and
// its own prior messages as "assistant" — chat()'s history is from the bot's perspective,
// this is the same conversation from the customer's perspective.
function flipToCustomerView(chatHistory) {
  return chatHistory.map((m) => ({
    role: m.role === 'user' ? 'assistant' : 'user',
    content: m.content,
  }));
}

async function getCustomerMessage(scenario, chatHistory) {
  const customerMessages = flipToCustomerView(chatHistory);
  const messages = customerMessages.length
    ? customerMessages
    : [{ role: 'user', content: 'Send your opening message to start the conversation, in character.' }];

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system: buildCustomerSystemPrompt(scenario),
    messages,
  });

  const raw = response.content[0].text;
  const done = raw.includes(DONE_MARKER);
  const text = raw.replace(DONE_MARKER, '').trim();
  return { text, done };
}

async function simulateConversation(scenario) {
  let chatHistory = [];
  const transcript = [];

  for (let turn = 0; turn < scenario.maxTurns; turn++) {
    const { text: customerText, done } = await getCustomerMessage(scenario, chatHistory);
    transcript.push({ speaker: 'customer', text: customerText });

    const result = await chat(chatHistory, customerText);
    chatHistory = result.history;
    transcript.push({
      speaker: 'bot',
      text: result.message,
      // Full part rows, not just SKUs — the judge needs every field (install_difficulty,
      // emissions_standard, state_restrictions, attributes, etc.), not a hand-picked subset,
      // or it will flag real, grounded claims (e.g. "bolt-on", "legal in all 50 states") as
      // fabricated simply because the harness didn't forward the field that supports them.
      fitmentResults: result.fitmentResults,
      clarifyingOptions: result.clarifyingOptions,
    });

    if (done) break;
  }

  return transcript;
}

const JUDGE_TOOL = {
  name: 'grade_conversation',
  description: 'Grade a customer-support conversation transcript against a quality rubric.',
  input_schema: {
    type: 'object',
    properties: {
      textDataConsistent: {
        type: 'boolean',
        description: 'True if the bot never said something contradicting the data actually returned in that same turn — e.g. never implied results were being withheld when fitmentResults was already populated, and never presented results as final when fitmentResults was null.',
      },
      oneQuestionAtATime: {
        type: 'boolean',
        description: 'True if the bot never bundled two or more distinct follow-up questions into a single message.',
      },
      qualifierButtonsCorrect: {
        type: 'boolean',
        description: 'True if clarifyingOptions (clickable buttons) only ever appeared for a genuine fitment qualifier the customer could not be expected to know unprompted (e.g. rear suspension type) and never for a vehicle fact the customer already knows (trim, body style).',
      },
      noFabrication: {
        type: 'boolean',
        description: 'True if every factual claim (SKU, price, spec, sound level, install difficulty, emissions/legal status) in the bot\'s replies is grounded in the fitmentResults actually provided, OR is one of the bot\'s own sanctioned sound-level/install-difficulty translation phrases supplied to you below (the bot is instructed to use these close to verbatim, so matching or lightly paraphrasing them is NEVER fabrication, even though the exact wording doesn\'t appear in the raw fitmentResults fields). Reasonable paraphrasing or marketing framing of a real data field is also NOT fabrication. Only flag an INVENTED fact: a spec, number, warranty/hardware claim, competitor comparison, or excuse (e.g. claiming a system/access limitation) that has no basis at all in the provided fitmentResults fields or the sanctioned translation phrases.',
      },
      correctOutcome: {
        type: 'boolean',
        description: 'True if every SKU in groundTruth.expectSkus appears somewhere in a fitmentResults value in the transcript, AND no SKU in groundTruth.rejectSkus ever appears, AND (if groundTruth.expectNoMatch is true) fitmentResults stayed null throughout with no fabricated SKU. Extra SKUs that appear but are not listed in expectSkus or rejectSkus are perfectly fine and do NOT make this false — expectSkus is a "these must be included" list, not an exclusive list of the only acceptable SKUs.',
      },
      toneAppropriate: {
        type: 'boolean',
        description: 'True if replies stayed concise and sales-assist in tone, and never recommended or endorsed a competitor brand/product. The bot IS MagnaFlow\'s own advisor (its system prompt identifies it as "the MagnaFlow Parts Advisor") — directing a customer to MagnaFlow\'s own website/team/advisors, or naming MagnaFlow\'s own product lines, is the bot recommending itself, not a competitor, and is never a violation. Only flag naming or endorsing a genuinely different brand (e.g. Borla, Flowmaster, or any non-MagnaFlow name).',
      },
      issues: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific problems found. Each entry MUST include a verbatim quote (copy-pasted substring, at least 10 characters, not paraphrased) of the exact offending text from the transcript above, wrapped in double quotes ("like this"), followed by an explanation. If you cannot locate an exact quote in the transcript that demonstrates the problem, do not report it — a paraphrase you cannot back with a real quote is not a valid finding. Empty array if none.',
      },
      overallVerdict: { type: 'string', enum: ['pass', 'fail'] },
    },
    required: [
      'textDataConsistent', 'oneQuestionAtATime', 'qualifierButtonsCorrect', 'noFabrication',
      'correctOutcome', 'toneAppropriate', 'issues', 'overallVerdict',
    ],
  },
};

function formatTranscriptForJudge(transcript) {
  return transcript
    .map((turn) => {
      if (turn.speaker === 'customer') return `CUSTOMER: ${turn.text}`;
      const dataNote = `[data this turn: fitmentResults=${JSON.stringify(turn.fitmentResults)}, clarifyingOptions=${JSON.stringify(turn.clarifyingOptions)}]`;
      return `BOT: ${turn.text}\n${dataNote}`;
    })
    .join('\n\n');
}

// Extracts quoted substrings from an issue string and checks each appears verbatim
// (case/whitespace-insensitive) somewhere in the actual transcript. Judges can hallucinate
// specific claims that sound plausible but never happened — confirmed directly in this
// harness (a claimed "bundled two questions" issue that didn't exist in the real reply).
// This doesn't replace reading the transcript, but flags a claim as suspect automatically
// when it doesn't back up its own quote, rather than trusting the judge's prose at face value.
function verifyIssueQuotes(issue, transcriptText) {
  const normalize = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const haystack = normalize(transcriptText);
  const quoted = [...issue.matchAll(/["“]([^"”]{10,})["”]/g)].map((m) => m[1]);
  if (quoted.length === 0) return 'no_quote';
  const allFound = quoted.every((q) => haystack.includes(normalize(q)));
  return allFound ? 'verified' : 'unverified';
}

async function judgeConversation(scenario, transcript) {
  const groundTruthText = JSON.stringify(scenario.groundTruth);
  const prompt = `Grade the following customer support conversation transcript using the grade_conversation tool.

Ground truth for this scenario (what SHOULD have happened, for your reference only — the customer never saw this): ${groundTruthText}

Each BOT turn is annotated with the actual raw data returned that turn (fitmentResults = the exact SKUs delivered to the customer that turn, or null; clarifyingOptions = clickable qualifier buttons shown, or null). Use that data, not just the bot's prose, to judge textDataConsistent and correctOutcome.

The bot's own system prompt instructs it to translate raw sound_level/install_difficulty enum values into these exact (or lightly paraphrased) phrases — treat any use of these as grounded, not fabricated:
${SYSTEM_PROMPT.match(/## Sound level translations[\s\S]*?## Tone/)?.[0]?.replace(/## Tone[\s\S]*/, '').trim()}

TRANSCRIPT:
${formatTranscriptForJudge(transcript)}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    tools: [JUDGE_TOOL],
    tool_choice: { type: 'tool', name: 'grade_conversation' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  const verdict = toolUse?.input ?? {};
  // A long transcript can push the judge's tool call past max_tokens, truncating the JSON
  // mid-array — confirmed directly (a run crashed on `verdict.issues.map is not a function`
  // because issues came back undefined). Default defensively rather than crash the whole suite.
  if (!Array.isArray(verdict.issues)) verdict.issues = [];
  if (!verdict.overallVerdict) verdict.overallVerdict = 'fail';
  return verdict;
}

async function main() {
  const nameFilter = process.argv[2];
  const scenarios = nameFilter
    ? SCENARIOS.filter((s) => s.name.toLowerCase().includes(nameFilter.toLowerCase()))
    : SCENARIOS;

  if (scenarios.length === 0) {
    console.log(`No scenarios match "${nameFilter}".`);
    return;
  }

  const results = [];
  for (const scenario of scenarios) {
    process.stdout.write(`\n=== ${scenario.name} ===\n`);
    try {
      const transcript = await simulateConversation(scenario);
      for (const turn of transcript) {
        if (turn.speaker === 'customer') console.log(`  CUSTOMER: ${turn.text}`);
        else console.log(`  BOT: ${turn.text.slice(0, 200)}${turn.text.length > 200 ? '…' : ''}`);
      }
      const verdict = await judgeConversation(scenario, transcript);
      const transcriptText = transcript.map((t) => t.text).join(' ');
      const annotatedIssues = verdict.issues.map((issue) => ({
        issue,
        quoteStatus: verifyIssueQuotes(issue, transcriptText),
      }));
      results.push({ name: scenario.name, transcript, verdict, annotatedIssues });
      console.log(`  --> ${verdict.overallVerdict.toUpperCase()}`);
      for (const { issue, quoteStatus } of annotatedIssues) {
        const tag = quoteStatus === 'unverified' ? '[UNVERIFIED QUOTE — possible judge hallucination] ' : quoteStatus === 'no_quote' ? '[no quote given] ' : '';
        console.log(`    - ${tag}${issue}`);
      }
    } catch (err) {
      results.push({ name: scenario.name, error: err.message, verdict: { overallVerdict: 'fail' } });
      console.log(`  ERROR: ${err.message}`);
    }
  }

  const failed = results.filter((r) => r.verdict.overallVerdict !== 'pass');
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed.`);
  if (failed.length > 0) {
    console.log('\nFailures (full detail):');
    for (const f of failed) {
      console.log(`\n- ${f.name}`);
      if (f.error) {
        console.log(`  ERROR: ${f.error}`);
        continue;
      }
      for (const [key, value] of Object.entries(f.verdict)) {
        if (key === 'issues' || key === 'overallVerdict') continue;
        if (value === false) console.log(`  FAILED CHECK: ${key}`);
      }
      for (const { issue, quoteStatus } of f.annotatedIssues ?? []) {
        const tag = quoteStatus === 'unverified' ? '[UNVERIFIED QUOTE] ' : quoteStatus === 'no_quote' ? '[no quote] ' : '';
        console.log(`  - ${tag}${issue}`);
      }
    }
    process.exitCode = 1;
  }
}

main();
