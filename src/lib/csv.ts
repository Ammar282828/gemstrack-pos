
import { Product, Settings, calculateProductCosts } from './store';

/**
 * Generates a CSV string from an array of products for tag printing.
 * Pairs products into a single row to support "two tags per label" formats.
 * @param products The array of products to include in the CSV.
 * @param settings The current application settings for shop name and metal rates.
 */
export function generateProductCsv(products: Product[], settings: Settings): void {
  const baseHeaders = [
    // Primary Details
    'sku', 'product_name', 'category_id', 'shop_name', 'image_url',
    // Pricing
    'total_price_pkr', 'is_custom_price', 'custom_price',
    // Primary Metal
    'metal_type', 'metal_weight_g', 'karat',
    // Secondary Metal
    'secondary_metal_type', 'secondary_metal_weight_g', 'secondary_karat',
    // Stones & Diamonds
    'has_stones', 'stone_weight_g', 'has_diamonds', 'stone_details', 'diamond_details',
    // Charges
    'making_charges', 'diamond_charges', 'stone_charges', 'misc_charges', 'wastage_percentage',
    // QR
    'qr_content',
  ];

  // Create headers for Left (1) and Right (2) tags
  const headers = [
      ...baseHeaders.map(h => `${h}_1`), 
      ...baseHeaders.map(h => `${h}_2`)
  ];

  const ratesForCalc = {
      goldRatePerGram24k: settings.goldRatePerGram24k,
      goldRatePerGram22k: settings.goldRatePerGram22k,
      goldRatePerGram21k: settings.goldRatePerGram21k,
      goldRatePerGram18k: settings.goldRatePerGram18k,
      palladiumRatePerGram: settings.palladiumRatePerGram,
      platinumRatePerGram: settings.platinumRatePerGram,
      silverRatePerGram: settings.silverRatePerGram,
  };

  const rows: string[] = [];

  // Iterate by 2 to pair products
  for (let i = 0; i < products.length; i += 2) {
      const product1 = products[i];
      const product2 = products[i + 1]; // Can be undefined if odd number of products

      const getProductData = (product: Product | undefined) => {
          if (!product) {
              // Return empty strings for all fields if no second product
              const emptyData: Record<string, string> = {};
              baseHeaders.forEach(h => emptyData[h] = '');
              return emptyData;
          }

          const costs = calculateProductCosts(product, ratesForCalc);
          const formatField = (value: any): string => {
            if (value === null || value === undefined) return '';
            const str = String(value);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          };

          return {
            sku: formatField(product.sku),
            product_name: formatField(product.name),
            category_id: formatField(product.categoryId),
            shop_name: formatField(settings.shopName),
            image_url: formatField(product.imageUrl),
            total_price_pkr: costs.totalPrice.toFixed(2),
            is_custom_price: product.isCustomPrice ? 'TRUE' : 'FALSE',
            custom_price: product.customPrice?.toFixed(2) || '0',
            metal_type: formatField(product.metalType),
            metal_weight_g: product.metalWeightG.toFixed(3),
            karat: formatField(product.karat),
            secondary_metal_type: formatField(product.secondaryMetalType),
            secondary_metal_weight_g: product.secondaryMetalWeightG?.toFixed(3) || '0',
            secondary_karat: formatField(product.secondaryMetalKarat),
            has_stones: product.hasStones ? 'TRUE' : 'FALSE',
            stone_weight_g: product.stoneWeightG.toFixed(3),
            has_diamonds: product.hasDiamonds ? 'TRUE' : 'FALSE',
            stone_details: formatField(product.stoneDetails),
            diamond_details: formatField(product.diamondDetails),
            making_charges: product.makingCharges.toFixed(2),
            diamond_charges: product.diamondCharges.toFixed(2),
            stone_charges: product.stoneCharges.toFixed(2),
            misc_charges: product.miscCharges.toFixed(2),
            wastage_percentage: product.wastagePercentage.toFixed(2),
            qr_content: formatField(product.sku),
          };
      };

      const data1 = getProductData(product1);
      const data2 = getProductData(product2);

      const rowValues = [
          ...baseHeaders.map(h => data1[h as keyof typeof data1]),
          ...baseHeaders.map(h => data2[h as keyof typeof data2])
      ];

      rows.push(rowValues.join(','));
  }

  const csvContent = [headers.join(','), ...rows].join('\n');
  
  downloadCsv(csvContent, 'gemstrack_double_tag_export');
}

/**
 * Triggers a browser download of the CSV content.
 * @param csvContent The full CSV string content.
 * @param baseFileName The base name for the downloaded file.
 */
function downloadCsv(csvContent: string, baseFileName: string): void {
  const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' }); // Add BOM for Excel compatibility
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  link.setAttribute("download", `${baseFileName}_${timestamp}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
