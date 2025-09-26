
import { NextResponse } from 'next/server';
import { collection, getDocs, doc, getDoc, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Product, Settings, calculateProductCosts } from '@/lib/store';

// Set this route to be dynamically rendered, ensuring it fetches fresh data on every request.
export const dynamic = 'force-dynamic';

async function getGlobalSettings(): Promise<Settings | null> {
    const settingsDocRef = doc(db, 'app_settings', 'global');
    const docSnap = await getDoc(settingsDocRef);
    if (docSnap.exists()) {
        // Ensure we handle potentially missing weprintApiSkus
        const data = docSnap.data() as Settings;
        if (!data.weprintApiSkus) {
            data.weprintApiSkus = [];
        }
        return data;
    }
    return null;
}

export async function GET() {
  try {
    const settings = await getGlobalSettings();
    if (!settings) {
      return NextResponse.json({ error: 'Global settings not found. Please configure settings in the app first.' }, { status: 500 });
    }

    const { weprintApiSkus } = settings;

    if (!weprintApiSkus || weprintApiSkus.length === 0) {
        return NextResponse.json({ message: "No products have been published to the WEPrint API. Please select products in Settings > WEPrint API Management." });
    }
    
    // Firestore 'in' queries are limited to 30 items. We need to fetch in batches.
    const productsList: Product[] = [];
    const batchSize = 30;

    for (let i = 0; i < weprintApiSkus.length; i += batchSize) {
        const skuBatch = weprintApiSkus.slice(i, i + batchSize);
        const productsQuery = query(collection(db, 'products'), where('sku', 'in', skuBatch));
        const productsSnapshot = await getDocs(productsQuery);
        
        productsSnapshot.forEach(doc => {
            productsList.push(doc.data() as Product);
        });
    }

    if (productsList.length === 0) {
        return NextResponse.json([]);
    }

    const ratesForCalc = {
        goldRatePerGram24k: settings.goldRatePerGram24k,
        goldRatePerGram22k: settings.goldRatePerGram22k,
        goldRatePerGram21k: settings.goldRatePerGram21k,
        goldRatePerGram18k: settings.goldRatePerGram18k,
        palladiumRatePerGram: settings.palladiumRatePerGram,
        platinumRatePerGram: settings.platinumRatePerGram,
        silverRatePerGram: settings.silverRatePerGram,
    };

    const responseData = productsList.map(product => {
      const costs = calculateProductCosts(product, ratesForCalc);
      
      return {
        // --- Primary Details ---
        sku: product.sku,
        product_name: product.name,
        category_id: product.categoryId,
        description: product.description || '',
        shop_name: settings.shopName || '',
        image_url: product.imageUrl || '',
        
        // --- Pricing ---
        total_price_pkr: costs.totalPrice,
        is_custom_price: product.isCustomPrice || false,
        custom_price: product.customPrice || 0,
        
        // --- Cost Breakdown ---
        metal_cost: costs.metalCost,
        wastage_cost: costs.wastageCost,
        
        // --- Primary Metal Details ---
        metal_type: product.metalType,
        metal_weight_g: product.metalWeightG,
        karat: product.karat || '',
        
        // --- Secondary Metal Details ---
        secondary_metal_type: product.secondaryMetalType || '',
        secondary_metal_weight_g: product.secondaryMetalWeightG || 0,
        secondary_karat: product.secondaryMetalKarat || '',
        
        // --- Stones & Diamonds ---
        has_stones: product.hasStones || false,
        stone_weight_g: product.stoneWeightG || 0,
        has_diamonds: product.hasDiamonds || false,
        stone_details: product.stoneDetails || '',
        diamond_details: product.diamondDetails || '',
        
        // --- Charges ---
        making_charges: product.makingCharges,
        diamond_charges: product.diamondCharges,
        stone_charges: product.stoneCharges,
        misc_charges: product.miscCharges,
        wastage_percentage: product.wastagePercentage,
        
        // --- QR Content ---
        qr_content: product.sku,
      };
    });

    return NextResponse.json(responseData);
  } catch (error) {
    console.error('Error fetching products for WEPrint API:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Failed to fetch product data.', details: errorMessage }, { status: 500 });
  }
}
