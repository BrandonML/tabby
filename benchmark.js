import { performance } from 'perf_hooks';
import { JSDOM } from 'jsdom';

const dom = new JSDOM(`<!DOCTYPE html><p>Hello world</p>`);
const document = dom.window.document;

// Baseline implementation
function escapeHtmlDOM(value = "") {
    const el = document.createElement("span");
    el.textContent = value;
    return el.innerHTML;
}
function escapeAttributeDOM(value = "") {
    return escapeHtmlDOM(value).replaceAll('"', "&quot;");
}

// Optimized implementation
function escapeHtmlOptimized(value = "") {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}
function escapeAttributeOptimized(value = "") {
    return escapeHtmlOptimized(value).replaceAll('"', "&quot;");
}

const testString = 'The quick brown fox "jumps" <over> the lazy & dog.';

// Warmup
for (let i = 0; i < 1000; i++) {
    escapeAttributeDOM(testString);
    escapeAttributeOptimized(testString);
}

const iterations = 100000;

console.log("Benchmarking html escaping...");

let start = performance.now();
for (let i = 0; i < iterations; i++) {
    escapeHtmlDOM(testString);
}
let end = performance.now();
const baselineHtml = end - start;
console.log(`DOM escapeHtml (Baseline): ${baselineHtml.toFixed(2)} ms`);

start = performance.now();
for (let i = 0; i < iterations; i++) {
    escapeHtmlOptimized(testString);
}
end = performance.now();
const optimizedHtml = end - start;
console.log(`Optimized escapeHtml: ${optimizedHtml.toFixed(2)} ms`);
console.log(`Improvement: ${((baselineHtml - optimizedHtml) / baselineHtml * 100).toFixed(2)}% faster (${(baselineHtml / optimizedHtml).toFixed(2)}x)`);

console.log("\nBenchmarking attribute escaping...");

start = performance.now();
for (let i = 0; i < iterations; i++) {
    escapeAttributeDOM(testString);
}
end = performance.now();
const baselineAttr = end - start;
console.log(`DOM escapeAttribute (Baseline): ${baselineAttr.toFixed(2)} ms`);

start = performance.now();
for (let i = 0; i < iterations; i++) {
    escapeAttributeOptimized(testString);
}
end = performance.now();
const optimizedAttr = end - start;
console.log(`Optimized escapeAttribute: ${optimizedAttr.toFixed(2)} ms`);
console.log(`Improvement: ${((baselineAttr - optimizedAttr) / baselineAttr * 100).toFixed(2)}% faster (${(baselineAttr / optimizedAttr).toFixed(2)}x)`);
