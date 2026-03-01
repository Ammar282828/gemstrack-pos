
"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAppStore, Product } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Loader2, FileSpreadsheet, Download, ArrowLeft, Trash2, PlusCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { generateProductCsv } from '@/lib/csv';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useRouter } from 'next/navigation';
import { Label } from '@/components/ui/label';
import { produce } from 'immer';
import { QrCode } from 'lucide-react';

// --- Types ---
interface LabelField {
  id: string;
  type: 'text' | 'qr';
  x: number;
  y: number;
  rotation?: 0 | 90 | 180 | 270;
  data: string;
  fontFamily?: string;
  fontSize?: number;
  qrMagnification?: number;
}

interface LabelLayout {
  id: string;
  name: string;
  widthDots: number;
  heightDots: number;
  fields: LabelField[];
}


// --- Default Layout ---
const defaultLayout: LabelLayout = {
  id: 'zebra-2000t-jewellery',
  name: 'Zebra 2000T Jewellery Tag (83x37mm)',
  widthDots: 664, // 83mm at 8dpmm
  heightDots: 296, // 37mm at 8dpmm
  fields: [
    {
      id: 'sku-left',
      type: 'text',
      x: 100, y: 150,
      data: 'SKU: {sku}',
      fontSize: 20,
      rotation: 90,
    },
    {
      id: 'qr-right',
      type: 'qr',
      x: 450, y: 80,
      data: '{sku}',
      qrMagnification: 4,
    }
  ],
};

// --- Components ---

const ProductSearch: React.FC<{ onSelect: (product: Product) => void, selectedProduct: Product | null }> = ({ onSelect, selectedProduct }) => {
  const products = useAppStore(state => state.products);
  const [searchTerm, setSearchTerm] = useState('');
  const [open, setOpen] = useState(false);

  const filteredProducts = useMemo(() => {
    if (!searchTerm) return [];
    return products.filter(p =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchTerm.toLowerCase())
    ).slice(0, 50);
  }, [products, searchTerm]);

  const handleSelect = (product: Product) => {
    onSelect(product);
    setOpen(false);
    setSearchTerm('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-start text-left">
          <Search className="mr-2 h-4 w-4" />
          {selectedProduct ? `${selectedProduct.name} (${selectedProduct.sku})` : "Search for a product..."}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <div className="p-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Search by name or SKU..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              autoFocus
            />
          </div>
        </div>
        <ScrollArea className="h-64">
          {filteredProducts.length > 0 ? (
            <div className="p-2">
              {filteredProducts.map(product => (
                <button key={product.sku} onClick={() => handleSelect(product)}
                  className="w-full text-left p-2 rounded-md hover:bg-muted flex items-center gap-3">
                  <div>
                    <p className="font-medium">{product.name}</p>
                    <p className="text-xs text-muted-foreground">{product.sku}</p>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <p className="p-4 text-center text-sm text-muted-foreground">
              {searchTerm ? 'No products found.' : 'Start typing to search...'}
            </p>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
};


const FieldPreview: React.FC<{ field: LabelField; scale: number }> = ({ field, scale }) => {
  const style: React.CSSProperties = {
    left: `${field.x * scale}px`,
    top: `${field.y * scale}px`,
    transform: `rotate(${field.rotation || 0}deg)`,
    transformOrigin: 'top left',
    position: 'absolute',
    whiteSpace: 'nowrap',
    fontSize: `${(field.fontSize || 20) * scale}px`,
  };

  return (
    <div style={style}>
      {field.type === 'text' ? (
        <span className="border border-dashed border-blue-500 p-1">{field.data}</span>
      ) : (
        <div className="border border-dashed border-purple-500 p-1">
          <QrCode className="w-8 h-8" />
        </div>
      )}
    </div>
  );
};

const DumbbellTagOutline: React.FC = () => {
    const viewboxWidth = 664; // 83mm
    const viewboxHeight = 296; // 37mm

    // Printable heads are ~30mm wide (240 dots).
    const headWidth = 240;
    
    // The connecting strip is ~8mm wide (64 dots).
    const stripHeight = 64; 
    const stripY = (viewboxHeight - stripHeight) / 2;
    const stripWidth = viewboxWidth - (headWidth * 2);

    return (
        <svg
            className="absolute top-0 left-0 w-full h-full pointer-events-none"
            viewBox={`0 0 ${viewboxWidth} ${viewboxHeight}`}
            preserveAspectRatio="none"
        >
            <defs>
                 <mask id="dumbbell-mask">
                    <rect x="0" y="0" width={viewboxWidth} height={viewboxHeight} fill="white" />
                    {/* Cut out the areas that are NOT part of the tag */}
                    <rect x={headWidth} y="0" width={stripWidth} height={stripY} fill="black" />
                    <rect x={headWidth} y={stripY + stripHeight} width={stripWidth} height={viewboxHeight - (stripY + stripHeight)} fill="black" />
                </mask>
            </defs>
            {/* The colored background of the tag shape */}
            <rect 
                x="0" y="0" 
                width={viewboxWidth} height={viewboxHeight} 
                fill="currentColor"
                className="text-primary/5"
                mask="url(#dumbbell-mask)"
            />
            {/* The dashed border of the tag shape */}
            <path 
                d={`M0,0 L${headWidth},0 L${headWidth},${stripY} L${headWidth + stripWidth},${stripY} L${headWidth + stripWidth},0 L${viewboxWidth},0 L${viewboxWidth},${viewboxHeight} L${headWidth + stripWidth},${viewboxHeight} L${headWidth + stripWidth},${stripY + stripHeight} L${headWidth},${stripY + stripHeight} L${headWidth},${viewboxHeight} L0,${viewboxHeight} Z`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray="4 4"
                className="text-primary/20"
            />
        </svg>
    );
};


const TagPreview: React.FC<{
  layout: LabelLayout;
  scale: number;
}> = ({ layout, scale }) => {
  return (
    <div className="w-full relative bg-card border rounded-md overflow-hidden" style={{ aspectRatio: `${layout.widthDots} / ${layout.heightDots}` }}>
      <div className="relative w-full h-full">
        <DumbbellTagOutline />
        {layout.fields.map(field => (
          <FieldPreview key={field.id} field={field} scale={scale} />
        ))}
      </div>
    </div>
  );
};


const TagEditor: React.FC<{ layout: LabelLayout; setLayout: React.Dispatch<React.SetStateAction<LabelLayout>>; }> = ({ layout, setLayout }) => {
  const handleFieldChange = useCallback((index: number, key: keyof LabelField, value: unknown) => {
    setLayout(
      produce(draft => {
        (draft.fields[index] as Record<string, unknown>)[key] = value;
      })
    );
  }, [setLayout]);

  const addField = useCallback(() => {
    setLayout(
      produce(draft => {
        draft.fields.push({ id: `field-${Date.now()}`, type: 'text', x: 10, y: 10, data: 'New Text', fontSize: 20 });
      })
    );
  }, [setLayout]);

  const removeField = useCallback((index: number) => {
    setLayout(
      produce(draft => {
        draft.fields.splice(index, 1);
      })
    );
  }, [setLayout]);

  return (
    <div className="space-y-4">
      {layout.fields.map((field, index) => (
        <Card key={field.id} className="p-4">
          <div className="flex justify-between items-center mb-2">
            <h4 className="font-semibold">{field.id}</h4>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeField(index)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>X</Label>
              <Input type="number" value={field.x} onChange={(e) => handleFieldChange(index, 'x', parseInt(e.target.value, 10) || 0)} />
            </div>
            <div className="space-y-1">
              <Label>Y</Label>
              <Input type="number" value={field.y} onChange={(e) => handleFieldChange(index, 'y', parseInt(e.target.value, 10) || 0)} />
            </div>
            <div className="space-y-1">
              <Label>Data</Label>
              <Input value={field.data} onChange={(e) => handleFieldChange(index, 'data', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Font Size</Label>
              <Input type="number" value={field.fontSize ?? 20} onChange={(e) => handleFieldChange(index, 'fontSize', parseInt(e.target.value, 10) || 20)} />
            </div>
            <div className="space-y-1">
              <Label>Rotation</Label>
              <select value={field.rotation ?? 0} onChange={(e) => handleFieldChange(index, 'rotation', parseInt(e.target.value, 10))} className="w-full h-10 border rounded-md px-2 bg-background">
                <option value={0}>0°</option>
                <option value={90}>90°</option>
                <option value={180}>180°</option>
                <option value={270}>270°</option>
              </select>
            </div>
          </div>
        </Card>
      ))}
      <Button variant="outline" onClick={addField}>
        <PlusCircle className="mr-2 h-4 w-4" /> Add Text Field
      </Button>
    </div>
  );
};


function PrinterPageComponent() {
  const appReady = useAppReady();
  const { loadProducts, settings, addPrintHistory } = useAppStore();
  const { toast } = useToast();
  const router = useRouter();

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [layout, setLayout] = useState<LabelLayout>(defaultLayout);
  const [previewScale, setPreviewScale] = useState(0.5);
  const previewContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (appReady) loadProducts();
  }, [appReady, loadProducts]);

  useEffect(() => {
    const updateScale = () => {
      if (previewContainerRef.current) {
        const containerWidth = previewContainerRef.current.offsetWidth;
        setPreviewScale(containerWidth / layout.widthDots);
      }
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [layout.widthDots]);

  const handleDownloadCsv = (product: Product | null) => {
    if (!product) {
        toast({ title: "No Product Selected", description: "Please select a product to export.", variant: "destructive" });
        return;
    }
    
    generateProductCsv([product], settings);
    addPrintHistory(product.sku);
    toast({ title: "CSV Exported", description: `Product details for ${product.sku} exported.` });
  };
  
  if (!appReady) {
    return (
        <div className="flex h-screen w-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
    );
  }

  return (
    <div className="container mx-auto py-4 sm:py-8 space-y-8">
        <header>
           <Button variant="outline" onClick={() => router.back()} className="mb-4">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Settings
          </Button>
          <h1 className="text-3xl font-bold text-primary flex items-center"><FileSpreadsheet className="mr-3 h-8 w-8"/>Label Designer &amp; Exporter</h1>
          <p className="text-muted-foreground">Design your label layout and export product data to CSV for external printing apps like WEPrint.</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Interactive Tag Builder</CardTitle>
                <CardDescription>Drag and drop fields to position them on the tag.</CardDescription>
              </CardHeader>
              <CardContent ref={previewContainerRef}>
                <TagPreview layout={layout} scale={previewScale} />
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-1 space-y-6">
             <Card>
                <CardHeader>
                  <CardTitle>Test & Export</CardTitle>
                  <CardDescription>Select a product to preview and export its data.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                   <ProductSearch onSelect={setSelectedProduct} selectedProduct={selectedProduct}/>
                   <Button 
                      className="w-full" 
                      onClick={() => handleDownloadCsv(selectedProduct)}
                      disabled={!selectedProduct}
                  >
                      <Download className="mr-2 h-4 w-4"/>
                      Download CSV for Selected Product
                  </Button>
                </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Field Editor</CardTitle>
                 <CardDescription>Fine-tune field positions and properties.</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-96">
                   <TagEditor layout={layout} setLayout={setLayout} />
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
  );
}

export default function PrinterPage() {
    const [isMounted, setIsMounted] = useState(false);
    useEffect(() => setIsMounted(true), []);
    if (!isMounted) return null;
    return <PrinterPageComponent />;
}
