/** Map technical validation messages to plain English for the builder bottom bar. */
export function humanizeValidationError(message) {
  if (!message || typeof message !== "string") return String(message ?? "");

  const m = message.trim();

  if (/Cycle detected/i.test(m) || /circular step/i.test(m)) {
    return "This workflow has a loop between steps — remove the circular connection";
  }

  if (/needs Yes\/No connections/i.test(m)) {
    const label = m.match(/"([^"]+)"/)?.[1];
    return label
      ? `Connect both Yes and No branches on "${label}"`
      : "Connect both Yes and No branches on branching steps";
  }

  if (/Only one trigger allowed/i.test(m)) {
    return "This workflow can only have one trigger";
  }

  if (/Add a start step/i.test(m)) {
    return "Add a trigger to start the workflow";
  }

  if (/End Success or End Failure/i.test(m)) {
    return "Add an End Success or End Failure step to finish the flow";
  }

  if (/disconnected/i.test(m) && /edge/i.test(m)) {
    return "Some steps are not connected — link them on the canvas";
  }

  if (/CompareStrings/i.test(m) && /left/i.test(m)) {
    return "Set what to compare on your If / Compare Strings step";
  }

  if (/SendEmail.*to/i.test(m) || (/Send Email/i.test(m) && /recipient/i.test(m))) {
    return "Choose who receives the email (To field)";
  }

  if (/CreateTicket/i.test(m) && /title/i.test(m)) {
    return "Add a ticket title on Create Ticket";
  }

  return m;
}

export function humanizeValidationErrors(errors = []) {
  return errors.map(humanizeValidationError);
}
