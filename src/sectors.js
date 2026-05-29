'use strict';

/**
 * Business sectors the agent can search for.
 * Each sector maps to one or more OpenStreetMap tag filters (key + values).
 * These are used to build the Overpass QL query. No API key is required.
 */
const SECTORS = [
  {
    key: 'food',
    label: 'Restaurants & Food',
    filters: [
      { k: 'amenity', v: ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'food_court', 'ice_cream'] },
      { k: 'shop', v: ['bakery', 'pastry', 'butcher', 'deli', 'confectionery', 'greengrocer', 'seafood', 'cheese', 'coffee'] },
    ],
  },
  {
    key: 'retail',
    label: 'Retail Shops',
    filters: [
      { k: 'shop', v: ['supermarket', 'convenience', 'clothes', 'shoes', 'jewelry', 'gift', 'furniture', 'electronics', 'mobile_phone', 'hardware', 'florist', 'books', 'toys', 'sports', 'department_store', 'variety_store'] },
    ],
  },
  {
    key: 'health',
    label: 'Health & Medical',
    filters: [
      { k: 'amenity', v: ['pharmacy', 'clinic', 'hospital', 'doctors', 'dentist', 'veterinary'] },
      { k: 'healthcare', v: ['*'] },
      { k: 'shop', v: ['optician', 'medical_supply', 'chemist'] },
    ],
  },
  {
    key: 'beauty',
    label: 'Beauty & Wellness',
    filters: [
      { k: 'shop', v: ['hairdresser', 'beauty', 'cosmetics', 'massage', 'tattoo'] },
      { k: 'leisure', v: ['fitness_centre', 'sports_centre'] },
      { k: 'amenity', v: ['spa'] },
    ],
  },
  {
    key: 'professional',
    label: 'Professional Offices',
    filters: [
      { k: 'office', v: ['company', 'lawyer', 'accountant', 'estate_agent', 'insurance', 'financial', 'it', 'consulting', 'advertising_agency', 'architect', 'employment_agency', 'tax_advisor', 'engineer', 'logistics'] },
    ],
  },
  {
    key: 'crafts',
    label: 'Crafts & Construction',
    filters: [
      { k: 'craft', v: ['*'] },
      { k: 'shop', v: ['trade', 'doityourself', 'building_materials', 'paint'] },
    ],
  },
  {
    key: 'automotive',
    label: 'Automotive',
    filters: [
      { k: 'shop', v: ['car', 'car_repair', 'car_parts', 'tyres', 'motorcycle'] },
      { k: 'amenity', v: ['fuel', 'car_wash', 'car_rental'] },
    ],
  },
  {
    key: 'hospitality',
    label: 'Hotels & Tourism',
    filters: [
      { k: 'tourism', v: ['hotel', 'guest_house', 'hostel', 'motel', 'apartment', 'resort'] },
    ],
  },
  {
    key: 'industry',
    label: 'Industry & Manufacturing',
    filters: [
      { k: 'man_made', v: ['works'] },
      { k: 'industrial', v: ['*'] },
      { k: 'office', v: ['research', 'telecommunication'] },
      { k: 'craft', v: ['agricultural_engines', 'metal_construction', 'electronics_repair'] },
    ],
  },
  {
    key: 'education',
    label: 'Education',
    filters: [
      { k: 'amenity', v: ['school', 'college', 'university', 'kindergarten', 'language_school', 'driving_school', 'training'] },
    ],
  },
];

module.exports = { SECTORS };
