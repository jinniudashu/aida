const fs = require("fs");
const sessionDir = "/root/.openclaw/agents/main/sessions/";
const files = fs.readdirSync(sessionDir).filter(f => f.endsWith(".jsonl")).sort();
const newest = files[files.length - 1];
console.log("Analyzing:", newest);

const lines = fs.readFileSync(sessionDir + newest, "utf8").trim().split("\n");
const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

// Timeline: group all entries by time period
const TEST_START = new Date("2026-03-08T02:30:00Z").getTime(); // 10:30 CST
const CRON_START = new Date("2026-03-08T01:00:00Z").getTime(); // 09:00 CST

const msgs = entries.filter(e => e.type === "message");
const before = msgs.filter(e => e.timestamp < CRON_START);
const cron = msgs.filter(e => e.timestamp >= CRON_START && e.timestamp < TEST_START);
const test = msgs.filter(e => e.timestamp >= TEST_START);

console.log("\n=== Timeline ===");
console.log("Before 09:00 CST:", before.length, "messages");
console.log("09:00-10:30 CST (cron):", cron.length, "messages");
console.log("After 10:30 CST (test):", test.length, "messages");

// Tool calls in each period
function countTools(msgList) {
  const counts = {};
  msgList.forEach(e => {
    if (e.message && e.message.role === "assistant" && Array.isArray(e.message.content)) {
      e.message.content.forEach(b => {
        if (b.name) counts[b.name] = (counts[b.name] || 0) + 1;
      });
    }
  });
  return counts;
}

console.log("\n=== Tool calls by period ===");
console.log("Before 09:00:", JSON.stringify(countTools(before)));
console.log("Cron 09:00-10:30:", JSON.stringify(countTools(cron)));
console.log("Test 10:30+:", JSON.stringify(countTools(test)));

// Show what happened during test window
console.log("\n=== Test window (10:30+ CST) entries ===");
test.forEach((e, i) => {
  const role = e.message ? e.message.role : "?";
  const ts = new Date(e.timestamp).toISOString().slice(11, 19);
  let summary = "";
  if (role === "user") {
    const c = e.message.content;
    const text = typeof c === "string" ? c : Array.isArray(c) ? c.map(b => b.text || "").join(" ") : "";
    summary = text.slice(0, 120);
  } else if (role === "assistant") {
    const c = e.message.content;
    if (Array.isArray(c)) {
      const tools = c.filter(b => b.name).map(b => b.name);
      const texts = c.filter(b => b.type === "text").map(b => (b.text || "").slice(0, 80));
      if (tools.length > 0) summary = "TOOLS: " + tools.join(", ");
      if (texts.length > 0) summary += " TEXT: " + texts.join(" | ");
    } else if (typeof c === "string") {
      summary = c.slice(0, 120);
    }
  } else if (role === "toolResult") {
    const name = e.message.toolName || "?";
    const err = e.message.isError ? " ERROR" : "";
    summary = "result:" + name + err;
  }
  console.log("  [" + ts + "] " + role + ": " + summary.slice(0, 150));
});

// bps_update_entity inputs (safe)
console.log("\n=== bps_update_entity details ===");
msgs.forEach(e => {
  if (e.message && e.message.role === "assistant" && Array.isArray(e.message.content)) {
    e.message.content.forEach(b => {
      if (b.name === "bps_update_entity") {
        const input = b.input || b.arguments || {};
        console.log("  [" + new Date(e.timestamp).toISOString().slice(11, 19) + "] " + JSON.stringify(input).slice(0, 400));
      }
    });
  }
});

// write tool paths
console.log("\n=== write tool paths ===");
msgs.forEach(e => {
  if (e.message && e.message.role === "assistant" && Array.isArray(e.message.content)) {
    e.message.content.forEach(b => {
      if (b.name === "write") {
        const input = b.input || b.arguments || {};
        const path = input.path || input.filePath || input.file_path || "?";
        console.log("  [" + new Date(e.timestamp).toISOString().slice(11, 19) + "] " + path);
      }
    });
  }
});

// Find our test prompts specifically
console.log("\n=== Test prompts search ===");
const allUser = msgs.filter(e => e.message && e.message.role === "user");
allUser.forEach((e, i) => {
  const c = e.message.content;
  const text = typeof c === "string" ? c : Array.isArray(c) ? c.map(b => b.text || "").join(" ") : "";
  if (text.includes("闲氪") || text.includes("全权") || text.includes("建模完成") || text.includes("运营工作") || text.includes("运营小结")) {
    console.log("  FOUND [" + new Date(e.timestamp).toISOString().slice(11, 19) + "]: " + text.slice(0, 200));
  }
});
