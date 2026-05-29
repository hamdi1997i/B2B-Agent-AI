'use strict';

/**
 * Classification engine.
 * Turns raw OpenStreetMap tags into:
 *   - domain    : high-level business sector (Food, Retail, Health, ...)
 *   - category  : the precise activity (restaurant, pharmacy, ...)
 *   - needs     : the things this kind of business typically BUYS (purchase needs)
 *
 * The "needs" are what makes this a B2B targeting tool: you can export every
 * company that likely "needs packaging" or "needs software", etc.
 */

// Canonical list of purchase needs (used by the UI for filtering).
const ALL_NEEDS = [
  'software',        // POS, CRM, ERP, booking, e-commerce, website
  'packaging',       // boxes, bags, labels, food containers
  'marketing',       // advertising, SEO, social media, branding
  'logistics',       // shipping, delivery, fleet
  'equipment',       // machinery, tools, kitchen/medical equipment
  'raw_materials',   // ingredients, components, supplies
  'furniture',       // shop fitting, office furniture
  'cleaning',        // hygiene / cleaning supplies
  'security',        // alarms, cameras, access control
  'payments',        // payment terminals, fintech
  'hr_recruitment',  // staffing, recruitment
  'accounting',      // bookkeeping, tax services
  'training',        // staff training, e-learning
  'energy',          // utilities, solar, energy efficiency
];

// What each domain typically needs to buy.
const NEEDS_BY_DOMAIN = {
  'Food & Beverage':        ['software', 'packaging', 'marketing', 'raw_materials', 'cleaning', 'payments', 'equipment'],
  'Retail':                 ['software', 'packaging', 'marketing', 'security', 'payments', 'logistics', 'furniture'],
  'Health & Medical':       ['software', 'equipment', 'cleaning', 'marketing', 'security', 'accounting'],
  'Beauty & Wellness':      ['software', 'marketing', 'raw_materials', 'furniture', 'payments', 'training'],
  'Professional Services':  ['software', 'marketing', 'accounting', 'hr_recruitment', 'furniture', 'training'],
  'Crafts & Construction':  ['equipment', 'raw_materials', 'logistics', 'software', 'security', 'marketing'],
  'Automotive':             ['equipment', 'raw_materials', 'software', 'marketing', 'logistics', 'payments'],
  'Hospitality & Tourism':  ['software', 'marketing', 'cleaning', 'furniture', 'payments', 'energy', 'hr_recruitment'],
  'Industry & Manufacturing': ['equipment', 'raw_materials', 'logistics', 'packaging', 'software', 'energy', 'security'],
  'Education':              ['software', 'furniture', 'marketing', 'training', 'equipment', 'security'],
  'Other':                  ['software', 'marketing'],
};

// Map an OSM tag value to a (domain, category) pair.
function resolveDomain(tags) {
  const shop = tags.shop;
  const amenity = tags.amenity;
  const office = tags.office;
  const craft = tags.craft;
  const tourism = tags.tourism;
  const healthcare = tags.healthcare;
  const leisure = tags.leisure;

  const FOOD_AMENITY = ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'food_court', 'ice_cream'];
  const FOOD_SHOP = ['bakery', 'pastry', 'butcher', 'deli', 'confectionery', 'greengrocer', 'seafood', 'cheese', 'coffee', 'beverages', 'wine', 'alcohol'];
  const HEALTH_AMENITY = ['pharmacy', 'clinic', 'hospital', 'doctors', 'dentist', 'veterinary'];
  const BEAUTY_SHOP = ['hairdresser', 'beauty', 'cosmetics', 'massage', 'tattoo', 'perfumery'];
  const AUTO_SHOP = ['car', 'car_repair', 'car_parts', 'tyres', 'motorcycle'];
  const AUTO_AMENITY = ['fuel', 'car_wash', 'car_rental'];
  const EDU_AMENITY = ['school', 'college', 'university', 'kindergarten', 'language_school', 'driving_school', 'training'];

  if (amenity && FOOD_AMENITY.includes(amenity)) return ['Food & Beverage', amenity];
  if (shop && FOOD_SHOP.includes(shop)) return ['Food & Beverage', shop];

  if (amenity && HEALTH_AMENITY.includes(amenity)) return ['Health & Medical', amenity];
  if (healthcare) return ['Health & Medical', healthcare === 'yes' ? 'healthcare' : healthcare];
  if (shop && ['optician', 'medical_supply', 'chemist'].includes(shop)) return ['Health & Medical', shop];

  if (shop && BEAUTY_SHOP.includes(shop)) return ['Beauty & Wellness', shop];
  if (leisure && ['fitness_centre', 'sports_centre'].includes(leisure)) return ['Beauty & Wellness', leisure];
  if (amenity === 'spa') return ['Beauty & Wellness', 'spa'];

  if (shop && AUTO_SHOP.includes(shop)) return ['Automotive', shop];
  if (amenity && AUTO_AMENITY.includes(amenity)) return ['Automotive', amenity];

  if (tourism && ['hotel', 'guest_house', 'hostel', 'motel', 'apartment', 'resort'].includes(tourism)) {
    return ['Hospitality & Tourism', tourism];
  }

  if (amenity && EDU_AMENITY.includes(amenity)) return ['Education', amenity];

  if (tags.man_made === 'works' || tags.industrial) return ['Industry & Manufacturing', tags.industrial || 'works'];

  if (craft) return ['Crafts & Construction', craft];
  if (shop && ['trade', 'doityourself', 'building_materials', 'paint', 'hardware'].includes(shop)) {
    return ['Crafts & Construction', shop];
  }

  if (office) {
    // a few office types fit better in other domains
    if (office === 'it' || office === 'telecommunication' || office === 'research') {
      return ['Professional Services', office];
    }
    return ['Professional Services', office];
  }

  if (shop) return ['Retail', shop];

  return ['Other', amenity || tourism || leisure || 'unknown'];
}

function classify(tags) {
  const [domain, category] = resolveDomain(tags || {});
  const needs = NEEDS_BY_DOMAIN[domain] || NEEDS_BY_DOMAIN['Other'];
  return { domain, category, needs };
}

const ALL_DOMAINS = Object.keys(NEEDS_BY_DOMAIN);

module.exports = { classify, ALL_NEEDS, ALL_DOMAINS, NEEDS_BY_DOMAIN };
