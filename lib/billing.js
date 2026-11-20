export const TIERS = {
  free: {
    id: "free",
    name: "Starter",
    price: 0,
    rank: 0,
    maxDimension: 32,
    maxVolume: 32768,
    maxSavedBlocks: 12,
    description: "A free workspace for smaller builds."
  },
  builder_plus: {
    id: "builder_plus",
    name: "Builder+",
    price: 99,
    rank: 1,
    maxDimension: 64,
    maxVolume: 262144,
    maxSavedBlocks: 24,
    description: "More room for detailed structures."
  },
  pro: {
    id: "pro",
    name: "Pro",
    price: 249,
    rank: 2,
    maxDimension: 96,
    maxVolume: 750000,
    maxSavedBlocks: 48,
    description: "Large workspaces and a bigger saved palette."
  },
  studio: {
    id: "studio",
    name: "Studio",
    price: 499,
    rank: 3,
    maxDimension: 128,
    maxVolume: 1000000,
    maxSavedBlocks: 96,
    description: "The builder's full currently supported workspace capacity."
  }
};

export function getTier(id) {
  return TIERS[id] || TIERS.free;
}

export function publicTier(tier) {
  return {
    id: tier.id,
    name: tier.name,
    price: tier.price,
    rank: tier.rank,
    maxDimension: tier.maxDimension,
    maxVolume: tier.maxVolume,
    maxSavedBlocks: tier.maxSavedBlocks,
    description: tier.description
  };
}