// Recognizes hand shapes by comparing them with the examples the user recorded (k-nearest-neighbours).
// A hand is only given a word when it is close to recorded examples of that word; otherwise it is "Unknown Gesture".

const NEIGHBOURS = 5;
// Average per-coordinate difference (hand-size normalized) above which a hand is treated as unknown.
const MAX_DISTANCE = 0.35;
// Share of the nearest neighbours that must agree before a word is returned.
const MIN_VOTE_SHARE = 0.6;

// Turns 21 hand joints into 63 numbers that do not depend on where the hand is or how far it is from the camera.
export function extractFeatures(landmarks) {
  const wrist = landmarks[0];
  const middleKnuckle = landmarks[9];
  const handSize =
    Math.hypot(middleKnuckle.x - wrist.x, middleKnuckle.y - wrist.y, middleKnuckle.z - wrist.z) || 1;

  const features = [];
  for (const point of landmarks) {
    features.push(
      (point.x - wrist.x) / handSize,
      (point.y - wrist.y) / handSize,
      (point.z - wrist.z) / handSize,
    );
  }
  return features;
}

// Flipping the x values turns a left hand into a right hand, so each sign works with either hand.
function mirrorFeatures(features) {
  return features.map((value, index) => (index % 3 === 0 ? -value : value));
}

function averageDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const difference = a[i] - b[i];
    sum += difference * difference;
  }
  return Math.sqrt(sum / a.length);
}

// samples: [{ label: string, features: number[] }]
// Returns { label, confidence } where label is null for an unknown gesture.
export function classifyGesture(features, samples) {
  if (samples.length === 0) return { label: null, confidence: 0 };

  const mirrored = mirrorFeatures(features);
  const nearest = samples
    .map((sample) => ({
      label: sample.label,
      distance: Math.min(
        averageDistance(features, sample.features),
        averageDistance(mirrored, sample.features),
      ),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, NEIGHBOURS);

  const closest = nearest[0];
  if (closest.distance > MAX_DISTANCE) return { label: null, confidence: 0 };

  const votes = new Map();
  for (const neighbour of nearest) {
    votes.set(neighbour.label, (votes.get(neighbour.label) ?? 0) + 1);
  }
  let bestLabel = null;
  let bestVotes = 0;
  for (const [label, count] of votes) {
    if (count > bestVotes) {
      bestLabel = label;
      bestVotes = count;
    }
  }

  const voteShare = bestVotes / nearest.length;
  if (voteShare < MIN_VOTE_SHARE) return { label: null, confidence: 0 };

  const closeness = 1 - closest.distance / MAX_DISTANCE;
  return { label: bestLabel, confidence: voteShare * closeness };
}
