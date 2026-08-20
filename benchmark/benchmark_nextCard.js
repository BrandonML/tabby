import { performance } from 'perf_hooks';

// Mock randomCard
function randomCard(cards) {
    return cards[Math.floor(Math.random() * cards.length)];
}

// Baseline implementation
function nextCardBaseline(cards, seenIds = []) {
  const unseenCards = cards.filter((card) => !seenIds.includes(card.id));
  if (unseenCards.length) {
    const selected = randomCard(unseenCards);
    return { selected, nextSeenIds: [...new Set([...seenIds, selected.id])] };
  }
  return { selected: randomCard(cards), nextSeenIds: [] };
}

// Optimized implementation
function nextCardOptimized(cards, seenIds = []) {
  const seenSet = new Set(seenIds);
  const unseenCards = cards.filter((card) => !seenSet.has(card.id));
  if (unseenCards.length) {
    const selected = randomCard(unseenCards);
    seenSet.add(selected.id);
    return { selected, nextSeenIds: [...seenSet] };
  }
  return { selected: randomCard(cards), nextSeenIds: [] };
}

// Generate test data
function generateData(numCards, numSeen) {
    const cards = [];
    for (let i = 0; i < numCards; i++) {
        cards.push({ id: `card_${i}` });
    }
    const seenIds = [];
    // Half of the cards are seen, half are not, and a bunch of other seen ids
    for (let i = 0; i < numSeen; i++) {
        if (i < numCards / 2) {
            seenIds.push(`card_${i}`);
        } else {
            seenIds.push(`seen_${i}`);
        }
    }
    return { cards, seenIds };
}

const scenarios = [
    { cards: 50, seen: 100 },
    { cards: 50, seen: 1000 },
    { cards: 100, seen: 5000 },
];

const iterations = 10000;

console.log("Benchmarking nextCard...");

for (const scenario of scenarios) {
    console.log(`\nScenario: ${scenario.cards} cards, ${scenario.seen} seenIds`);
    const { cards, seenIds } = generateData(scenario.cards, scenario.seen);

    // Warmup
    for (let i = 0; i < 1000; i++) {
        nextCardBaseline(cards, seenIds);
        nextCardOptimized(cards, seenIds);
    }

    let start = performance.now();
    for (let i = 0; i < iterations; i++) {
        nextCardBaseline(cards, seenIds);
    }
    let end = performance.now();
    const baselineTime = end - start;
    console.log(`Baseline nextCard: ${baselineTime.toFixed(2)} ms`);

    start = performance.now();
    for (let i = 0; i < iterations; i++) {
        nextCardOptimized(cards, seenIds);
    }
    end = performance.now();
    const optimizedTime = end - start;
    console.log(`Optimized nextCard: ${optimizedTime.toFixed(2)} ms`);
    console.log(`Improvement: ${((baselineTime - optimizedTime) / baselineTime * 100).toFixed(2)}% faster (${(baselineTime / optimizedTime).toFixed(2)}x)`);
}
