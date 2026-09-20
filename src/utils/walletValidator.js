/**
 * Multi-chain wallet address validator & auto-detector for Cohesion Bot.
 * Supports: ETH (EVM), SOL, BTC, SEI, XION, AVAX, BSC, ZKS, ADA, RONIN, Bifrost, Polkadot.
 */

export const SUPPORTED_CHAINS = [
  'ETH',
  'SOL',
  'BTC',
  'SEI',
  'XION',
  'AVAX',
  'BSC',
  'ZKS',
  'ADA',
  'RONIN',
  'Bifrost',
  'Polkadot',
];

/**
 * Detects the blockchain network based on wallet address structure and regex patterns.
 * @param {string} address - Cleaned wallet address
 * @returns {string|null} - Detected chain identifier or null
 */
export function detectChain(address) {
  if (!address || typeof address !== 'string') return null;
  const trimmed = address.trim();

  // 1. Ronin (ronin:...)
  if (/^ronin:[a-fA-F0-9]{40}$/i.test(trimmed)) {
    return 'RONIN';
  }

  // 2. Cardano (addr1...)
  if (/^addr1[a-zA-Z0-9]{50,110}$/i.test(trimmed)) {
    return 'ADA';
  }

  // 3. Sei (sei1...)
  if (/^sei1[a-zA-Z0-9]{38,59}$/i.test(trimmed)) {
    return 'SEI';
  }

  // 4. Xion (xion1...)
  if (/^xion1[a-zA-Z0-9]{38,59}$/i.test(trimmed)) {
    return 'XION';
  }

  // 5. Bitcoin (Legacy: 1..., P2SH: 3..., SegWit/Taproot: bc1...)
  if (/^(1|3)[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed) || /^bc1[a-zA-HJ-NP-Z0-9]{25,62}$/i.test(trimmed)) {
    return 'BTC';
  }

  // 6. Polkadot (Substrate SS58 starting with 1, 47-49 chars)
  if (/^1[a-km-zA-HJ-NP-Z1-9]{46,48}$/.test(trimmed)) {
    return 'Polkadot';
  }

  // 7. Bifrost (Substrate address starting with d, e, or b)
  if (/^(bifrost1|d|e)[a-km-zA-HJ-NP-Z1-9]{40,55}$/i.test(trimmed)) {
    return 'Bifrost';
  }

  // 8. Solana (Base58, 32-44 characters, no 0, O, I, l)
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed) && !trimmed.startsWith('0x')) {
    return 'SOL';
  }

  // 9. EVM Compatible (0x... 40 hex chars: ETH, BSC, AVAX, ZKS)
  if (/^0x[a-fA-F0-9]{40}$/i.test(trimmed)) {
    // Default EVM standard is ETH; user can specify sub-flavor
    return 'ETH';
  }

  return null;
}

/**
 * Validates whether an address matches the required chain.
 * @param {string} address 
 * @param {string} chain 
 * @returns {boolean}
 */
export function isValidAddressForChain(address, chain) {
  if (!address) return false;
  const detected = detectChain(address);
  if (!detected) return false;

  const upperChain = chain ? chain.toUpperCase() : 'ETH';

  // Any EVM address is valid for ETH, BSC, AVAX, ZKS
  const evmChains = ['ETH', 'BSC', 'AVAX', 'ZKS'];
  if (evmChains.includes(upperChain) && evmChains.includes(detected)) {
    return true;
  }

  return detected.toUpperCase() === upperChain;
}
