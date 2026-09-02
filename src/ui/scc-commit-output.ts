export function splitCommitOutput(stdout: string): {
  subject: string;
  body: string;
  author: string;
  date: string;
  patch: string;
} {
  const text = String(stdout ?? '');
  const diffIndex = text.search(/^diff --git /m);
  const headerText = diffIndex >= 0 ? text.slice(0, diffIndex) : text;
  const patch = diffIndex >= 0 ? text.slice(diffIndex) : '';

  const lines = headerText.split('\n');
  let author = '';
  let date = '';
  const messageLines: string[] = [];

  for (const line of lines) {
    if (/^commit /.test(line)) continue;
    if (/^Author:\s*/.test(line)) {
      author = line.replace(/^Author:\s*/, '').trim();
      continue;
    }
    if (/^Date:\s*/.test(line)) {
      date = line.replace(/^Date:\s*/, '').trim();
      continue;
    }
    if (/^Merge:\s*/.test(line)) continue;
    if (/^\d+ files? changed/.test(line.trim())) break;
    if (/^\s*\S.*\|\s*\d+/.test(line)) continue;
    messageLines.push(line.replace(/^ {4}/, ''));
  }

  const message = messageLines.join('\n').trim();
  const [subject = '', ...rest] = message.split('\n');
  return { subject, body: rest.join('\n').trim(), author, date, patch };
}
