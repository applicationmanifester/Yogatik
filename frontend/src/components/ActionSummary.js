/** ActionSummary – helper to render tool results as human‑readable summary */

import { summariseToolResults } from '../toolSummary';

/**
 * Takes the raw tool results object and returns a ready‑to‑display string.
 * @param {Object} toolResults
 * @returns {string}
 */
export function formatActionSummary(toolResults) {
  return summariseToolResults(toolResults);
}

/**
 * React component that displays the summary.
 */
export default function ActionSummary({ toolResults }) {
  const summary = formatActionSummary(toolResults);
  return (
    <section className="action-summary">
      {summary || <p>No tool results gathered.</p>}
    </section>
  );
}
