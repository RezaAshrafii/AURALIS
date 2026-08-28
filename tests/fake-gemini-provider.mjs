import http from "node:http";

const port = Number(process.env.FAKE_GEMINI_PORT || 47999);
const answer = JSON.stringify({
  answer: "پاسخ آزمایشی معتبر از مسیر کامل Brain دریافت شد.",
  citations: [],
  grounding: "general",
});

const server = http.createServer((request, response) => {
  if (request.method !== "POST") {
    response.writeHead(405).end();
    return;
  }
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    const isProbe = body.includes("Reply with exactly OK.");
    const content = isProbe ? "OK" : answer;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        model: "gemini-test-double",
        choices: [{ message: { content } }],
      })
    );
  });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`FAKE_GEMINI_READY http://127.0.0.1:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
