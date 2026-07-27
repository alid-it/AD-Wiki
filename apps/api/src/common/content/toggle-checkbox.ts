/**
 * Schaltet den nullbasierten Checklisteneintrag in Markdown oder Tiptap-HTML.
 * Markdown-Beispiele in Code-Fences werden bewusst nicht als Aufgaben gezählt.
 */
export function toggleCheckboxInContent(
  content: string,
  checkboxIndex: number,
  checked: boolean,
): string | null {
  const htmlResult = toggleTiptapTaskItem(content, checkboxIndex, checked);
  if (htmlResult !== null) return htmlResult;
  return toggleMarkdownTaskItem(content, checkboxIndex, checked);
}

function toggleTiptapTaskItem(content: string, checkboxIndex: number, checked: boolean): string | null {
  let currentIndex = 0;
  let found = false;
  const updated = content.replace(/<li\b[^>]*>/gi, (tag) => {
    if (!/\bdata-type=(['"])taskItem\1/i.test(tag)) return tag;
    const index = currentIndex++;
    if (index !== checkboxIndex) return tag;
    const checkedAttribute = /\bdata-checked=(['"])(?:true|false)\1/i;
    if (!checkedAttribute.test(tag)) return tag;
    found = true;
    return tag.replace(checkedAttribute, `data-checked="${checked ? "true" : "false"}"`);
  });
  return found ? updated : null;
}

function toggleMarkdownTaskItem(content: string, checkboxIndex: number, checked: boolean): string | null {
  const parts = content.split(/(\r\n|\n|\r)/);
  let fence: { marker: "`" | "~"; length: number } | null = null;
  let currentIndex = 0;
  let found = false;

  for (let index = 0; index < parts.length; index += 1) {
    const line = parts[index];
    if (line === "\r\n" || line === "\n" || line === "\r") continue;

    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as "`" | "~";
      if (!fence) fence = { marker, length: fenceMatch[1].length };
      else if (fence.marker === marker && fenceMatch[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;

    const task = /^(\s*[-+*]\s+\[)([ xX])(\])/.exec(line);
    if (!task) continue;
    if (currentIndex === checkboxIndex) {
      parts[index] = `${task[1]}${checked ? "x" : " "}${task[3]}${line.slice(task[0].length)}`;
      found = true;
      break;
    }
    currentIndex += 1;
  }

  return found ? parts.join("") : null;
}
