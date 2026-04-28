import fs from 'fs';

const path = '../xsjprd55/api/telegram.js';
let content = fs.readFileSync(path, 'utf-8');

const oldBlock = `  console.log(\`[telegram] chatId=\${chatId} GROUP_ID=\${GROUP_ID} text="\${text}" sender=\${sender}\`);

  // Ignore messages from wrong group
  if (GROUP_ID && chatId !== String(GROUP_ID)) {
    console.log(\`[telegram] ignored: chatId \${chatId} !== GROUP_ID \${GROUP_ID}\`);
    return res.status(200).send('OK');
  }`;

const newBlock = `  console.log(\`[telegram] chatId=\${chatId} GROUP_ID=\${GROUP_ID} text="\${text}" sender=\${sender}\`);

  // DEBUG MODE: temporarily reply to any chat with its ID so user can discover GROUP_ID
  if (GROUP_ID && chatId !== String(GROUP_ID)) {
    await sendTelegram(chatId, \`🔧 *Debug:* This chat ID is \\\`\${chatId}\\\`.\\nCurrent GROUP_ID env is \\\`\${GROUP_ID}\\\`. Update Vercel env and redeploy to lock to this group.\`);
    return res.status(200).send('OK');
  }`;

if (!content.includes(oldBlock)) {
  console.error('OLD BLOCK NOT FOUND');
  process.exit(1);
}

content = content.replace(oldBlock, newBlock);
fs.writeFileSync(path, content);
console.log('Patched successfully');
