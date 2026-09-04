import type { FieldDefinition } from '@/lib/object-engine';

/**
 * Starting schemas (§8, §9).
 *
 * These are *seeded object definitions*, not hardcoded tables. A workspace
 * applies one and then edits it — the real-estate hierarchy is rows in
 * `custom_objects`, exactly like an object someone describes from scratch, so
 * a property business and a bakery run on the same engine.
 *
 * §8's hierarchy is modelled as relation fields rather than nested tables:
 * country → state → city → locality → project → unit. That keeps a level
 * optional (a standalone villa has no project) without a schema change.
 */

export type ObjectTemplateDefinition = {
  key: string;
  name: string;
  pluralName: string;
  description: string;
  titleField: string;
  fields: FieldDefinition[];
};

export type ObjectTemplate = {
  key: string;
  name: string;
  industry: string;
  description: string;
  objects: ObjectTemplateDefinition[];
};

const text = (
  key: string,
  label: string,
  extra: Partial<FieldDefinition> = {},
): FieldDefinition => ({
  key,
  label,
  type: 'text',
  filterable: true,
  ...extra,
});

export const OBJECT_TEMPLATES: ObjectTemplate[] = [
  {
    key: 'real_estate',
    name: 'Real estate inventory',
    industry: 'Real estate',
    description:
      'Locality → project → unit, with the attributes a buyer actually asks about: BHK, area, floor, facing, price and availability.',
    objects: [
      {
        key: 'locality',
        name: 'Locality',
        pluralName: 'Localities',
        description:
          'Country, state, city and locality — the geography a buyer names.',
        titleField: 'name',
        fields: [
          text('name', 'Locality', { required: true }),
          text('city', 'City', { required: true }),
          text('state', 'State'),
          text('country', 'Country'),
          {
            key: 'pin_code',
            label: 'PIN code',
            type: 'text',
            filterable: true,
          },
          { key: 'map_point', label: 'Map point', type: 'geo' },
        ],
      },
      {
        key: 'project',
        name: 'Project',
        pluralName: 'Projects',
        description: 'A development containing units.',
        titleField: 'name',
        fields: [
          text('name', 'Project name', { required: true }),
          {
            key: 'locality',
            label: 'Locality',
            type: 'relation',
            filterable: true,
            relatedObject: 'locality',
          },
          {
            key: 'status',
            label: 'Construction status',
            type: 'select',
            filterable: true,
            options: [
              'pre_launch',
              'under_construction',
              'ready_to_move',
              'completed',
            ],
          },
          {
            key: 'possession_date',
            label: 'Possession',
            type: 'date',
            filterable: true,
          },
          { key: 'rera_id', label: 'RERA registration', type: 'text' },
          { key: 'amenities', label: 'Amenities', type: 'long_text' },
          { key: 'brochure', label: 'Brochure', type: 'file' },
          { key: 'map_point', label: 'Map point', type: 'geo' },
        ],
      },
      {
        key: 'unit',
        name: 'Unit',
        pluralName: 'Units',
        description:
          'A sellable unit. This is what the agent quotes and books visits against.',
        titleField: 'name',
        fields: [
          text('name', 'Unit name', { required: true }),
          {
            key: 'project',
            label: 'Project',
            type: 'relation',
            filterable: true,
            relatedObject: 'project',
          },
          {
            key: 'unit_type',
            label: 'Configuration',
            type: 'select',
            filterable: true,
            options: [
              '1BHK',
              '2BHK',
              '3BHK',
              '4BHK',
              '5BHK+',
              'plot',
              'villa',
              'commercial',
            ],
          },
          {
            key: 'carpet_area',
            label: 'Carpet area (sq ft)',
            type: 'number',
            filterable: true,
          },
          {
            key: 'built_up_area',
            label: 'Built-up area (sq ft)',
            type: 'number',
            filterable: true,
          },
          { key: 'floor', label: 'Floor', type: 'number', filterable: true },
          {
            key: 'facing',
            label: 'Facing',
            type: 'select',
            filterable: true,
            options: [
              'east',
              'west',
              'north',
              'south',
              'north_east',
              'north_west',
              'south_east',
              'south_west',
            ],
          },
          {
            key: 'price',
            label: 'Price',
            type: 'currency',
            filterable: true,
            currency: 'INR',
          },
          {
            key: 'availability',
            label: 'Availability',
            type: 'select',
            filterable: true,
            options: ['available', 'on_hold', 'sold'],
          },
          {
            key: 'units_available',
            label: 'Units available',
            type: 'inventory',
            filterable: true,
          },
          { key: 'photo', label: 'Photo', type: 'image' },
          { key: 'floor_plan', label: 'Floor plan', type: 'image' },
          { key: 'walkthrough', label: 'Video walkthrough', type: 'video' },
          { key: 'tour_3d', label: '3D tour', type: 'model_3d' },
          { key: 'notes', label: 'Notes', type: 'long_text' },
        ],
      },
    ],
  },
  {
    key: 'commerce',
    name: 'Product catalogue',
    industry: 'Commerce',
    description:
      'Products and their variants, with stock the agent checks before promising anything.',
    objects: [
      {
        key: 'product',
        name: 'Product',
        pluralName: 'Products',
        description: 'What you sell. Variants carry the stock.',
        titleField: 'name',
        fields: [
          text('name', 'Product name', { required: true }),
          text('category', 'Category'),
          text('brand', 'Brand'),
          { key: 'description', label: 'Description', type: 'long_text' },
          {
            key: 'kind',
            label: 'Kind',
            type: 'select',
            filterable: true,
            // §9: a digital product is released only after verified payment,
            // so the engine has to know which products those are.
            options: ['physical', 'digital', 'service'],
          },
          {
            key: 'price',
            label: 'Price',
            type: 'currency',
            filterable: true,
            currency: 'INR',
          },
          { key: 'photo', label: 'Photo', type: 'image' },
          { key: 'active', label: 'Active', type: 'boolean', filterable: true },
        ],
      },
      {
        key: 'variant',
        name: 'Variant',
        pluralName: 'Variants',
        description:
          'Size, colour or plan. Stock lives here, not on the product.',
        titleField: 'name',
        fields: [
          text('name', 'Variant', { required: true }),
          {
            key: 'product',
            label: 'Product',
            type: 'relation',
            filterable: true,
            relatedObject: 'product',
          },
          text('sku', 'SKU'),
          text('size', 'Size'),
          text('colour', 'Colour'),
          {
            key: 'price',
            label: 'Price',
            type: 'currency',
            filterable: true,
            currency: 'INR',
          },
          {
            key: 'in_stock',
            label: 'In stock',
            type: 'inventory',
            filterable: true,
          },
          {
            key: 'delivery_asset',
            label: 'Digital delivery file',
            type: 'file',
          },
        ],
      },
    ],
  },
  {
    key: 'services',
    name: 'Services and appointments',
    industry: 'Services',
    description:
      'Bookable services with duration and price, for clinics, salons, studios and consultants.',
    objects: [
      {
        key: 'service',
        name: 'Service',
        pluralName: 'Services',
        description: 'Something a customer books time for.',
        titleField: 'name',
        fields: [
          text('name', 'Service', { required: true }),
          text('category', 'Category'),
          { key: 'description', label: 'What it covers', type: 'long_text' },
          {
            key: 'duration_minutes',
            label: 'Duration (minutes)',
            type: 'number',
            filterable: true,
          },
          {
            key: 'price',
            label: 'Price',
            type: 'currency',
            filterable: true,
            currency: 'INR',
          },
          {
            key: 'requires_prepayment',
            label: 'Needs payment to book',
            type: 'boolean',
            filterable: true,
          },
          { key: 'active', label: 'Active', type: 'boolean', filterable: true },
        ],
      },
    ],
  },
];
