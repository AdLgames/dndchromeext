import { canAct, effectiveSpeed, isDead } from "./combat";
import type { Combatant, Encounter, Rule } from "./types";

/**
 * Answers a handful of questions about the fight that is actually running.
 *
 * This is a small, deliberately literal grammar rather than anything that
 * tries to understand English. That is a fair trade here because a miss
 * costs nothing: the panel falls back to its ranked rules, which is what it
 * would have shown anyway. It never *acts* on a guess — it only ever offers
 * a verdict it can justify from the encounter state, with its reasons shown.
 */
export type CombatAnswer = {
  subject: Combatant;
  verdict: "yes" | "no" | "depends";
  headline: string;
  reasons: string[];
};

const ASKS_ABOUT_SELF = /\b(i|my|me|they|their|them)\b/i;

/** "can X …" / "could X …" — anything else is a rules lookup, not a question. */
const QUESTION = /\b(can|could|may|am i|is|does|do)\b/i;

type Intent = {
  test: RegExp;
  answer: (subject: Combatant, encounter: Encounter, rules: Map<string, Rule>, query: string)
    => Omit<CombatAnswer, "subject"> | null;
};

function conditionNames(subject: Combatant, rules: Map<string, Rule>): string {
  return subject.conditions.map((id) => rules.get(id)?.title ?? id).join(", ");
}

const INTENTS: Intent[] = [
  {
    // Movement first: "can I move" also matches the broader act/attack tests.
    test: /\b(move|walk|run|step|dash|reach|get away|move away)\b/,
    answer: (subject, _e, rules) => {
      const speed = effectiveSpeed(subject);
      const left = Math.max(0, speed - subject.movementUsed);
      if (isDead(subject)) return { verdict: "no", headline: `${subject.name} is dead.`, reasons: [] };
      if (speed === 0) {
        return {
          verdict: "no",
          headline: `${subject.name} can't move — speed is 0.`,
          reasons: [`${conditionNames(subject, rules)} reduces speed to 0.`],
        };
      }
      return {
        verdict: left > 0 ? "yes" : "no",
        headline: left > 0
          ? `${subject.name} has ${left} ft of movement left.`
          : `${subject.name} has used all ${speed} ft of movement this turn.`,
        reasons: [`Speed ${speed} ft, ${subject.movementUsed} ft used.`],
      };
    },
  },
  {
    test: /\b(cast|spell|concentrat)/,
    answer: (subject, _e, rules, query) => {
      const reasons: string[] = [];
      if (!canAct(subject)) {
        return {
          verdict: "no",
          headline: `${subject.name} can't cast anything — they can't take actions.`,
          reasons: [subject.conditions.length ? conditionNames(subject, rules) : "At 0 hit points."],
        };
      }

      // Name the spell if the question contains one they are carrying.
      const named = subject.actions.find((a) =>
        a.kind === "spell" && query.includes(a.name.toLowerCase())
      );
      const spellRule = named?.ruleId ? rules.get(named.ruleId) : undefined;
      const needsConcentration = spellRule?.spell?.concentration ?? false;

      if (subject.actionUsed && subject.bonusUsed) {
        reasons.push("Action and bonus action are both spent this turn.");
      } else {
        reasons.push(subject.actionUsed ? "Action spent; a bonus-action spell is still available." : "Action available.");
      }

      if (subject.concentrating) {
        reasons.push(needsConcentration
          ? `Already concentrating${subject.concentrationNote ? ` on ${subject.concentrationNote}` : ""} — casting this would end it.`
          : `Concentrating${subject.concentrationNote ? ` on ${subject.concentrationNote}` : ""}, which this would not disturb.`);
      }

      if (named) {
        return {
          verdict: subject.actionUsed && subject.bonusUsed ? "no" : "depends",
          headline: `${subject.name} has ${named.name} on their sheet.`,
          reasons,
        };
      }

      return {
        verdict: subject.actionUsed && subject.bonusUsed ? "no" : "depends",
        headline: `${subject.name} can cast, subject to what is on their sheet.`,
        reasons,
      };
    },
  },
  {
    test: /\b(attack|hit|strike|shoot|swing|stab)\b/,
    answer: (subject, _e, rules) => {
      if (!canAct(subject)) {
        return {
          verdict: "no",
          headline: `${subject.name} can't attack.`,
          reasons: [subject.conditions.length ? conditionNames(subject, rules) : "At 0 hit points."],
        };
      }
      return {
        verdict: subject.actionUsed ? "no" : "yes",
        headline: subject.actionUsed
          ? `${subject.name} has already used their action this turn.`
          : `${subject.name} still has their action.`,
        reasons: subject.conditions.length
          ? [`Conditions in play: ${conditionNames(subject, rules)} — the tracker applies these to the roll.`]
          : [],
      };
    },
  },
  {
    test: /\b(reaction|opportunity)\b/,
    answer: (subject) => ({
      verdict: subject.reactionUsed ? "no" : "yes",
      headline: subject.reactionUsed
        ? `${subject.name} has already used their reaction this round.`
        : `${subject.name} still has their reaction.`,
      reasons: [],
    }),
  },
  {
    test: /\b(bonus action|bonus)\b/,
    answer: (subject) => ({
      verdict: subject.bonusUsed ? "no" : "yes",
      headline: subject.bonusUsed
        ? `${subject.name} has already used their bonus action.`
        : `${subject.name} still has their bonus action.`,
      reasons: [],
    }),
  },
  {
    test: /\b(act|do anything|take an action|my turn|their turn)\b/,
    answer: (subject, _e, rules) => {
      if (isDead(subject)) return { verdict: "no", headline: `${subject.name} is dead.`, reasons: [] };
      const able = canAct(subject);
      return {
        verdict: able ? "yes" : "no",
        headline: able
          ? `${subject.name} can act.`
          : `${subject.name} can't take actions.`,
        reasons: subject.conditions.length ? [conditionNames(subject, rules)] : [],
      };
    },
  },
];

/**
 * Resolves the question's subject: a combatant named in it, or whoever's
 * turn it is. Returns null when the query is not a question about the fight,
 * which is the common case and must stay cheap.
 */
export function answerFromCombat(
  query: string,
  encounter: Encounter,
  active: Combatant | undefined,
  rules: Map<string, Rule>
): CombatAnswer | null {
  const text = query.trim().toLowerCase();
  if (text.length < 4 || !QUESTION.test(text)) return null;
  if (!encounter.started || !encounter.combatants.length) return null;

  // Longest name first, so "Goblin 2" wins over "Goblin".
  const named = [...encounter.combatants]
    .sort((a, b) => b.name.length - a.name.length)
    .find((c) => text.includes(c.name.toLowerCase()));

  const subject = named ?? (ASKS_ABOUT_SELF.test(text) ? active : undefined) ?? active;
  if (!subject) return null;

  for (const intent of INTENTS) {
    if (!intent.test.test(text)) continue;
    const answer = intent.answer(subject, encounter, rules, text);
    if (answer) return { subject, ...answer };
  }
  return null;
}
