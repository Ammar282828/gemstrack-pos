
"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAppStore, Product } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Loader2, FileSpreadsheet, History, Download, ArrowLeft, Trash2, PlusCircle, MinusCircle, Move, RotateCw, ZoomIn } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { generateProductCsv } from '@/lib/csv';
import { format } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useRouter } from 'next/navigation';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { produce } from 'immer';

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

const ItemTypes = {
  FIELD: 'field',
};

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


const DraggableField: React.FC<{
  field: LabelField;
  scale: number;
  onMove: (id: string, x: number, y: number) => void;
}> = ({ field, scale, onMove }) => {
  const ref = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag(() => ({
    type: ItemTypes.FIELD,
    item: { id: field.id, x: field.x, y: field.y },
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
    }),
  }), [field.id, field.x, field.y]);

  drag(ref);

  const style: React.CSSProperties = {
    left: `${field.x * scale}px`,
    top: `${field.y * scale}px`,
    transform: `rotate(${field.rotation || 0}deg)`,
    transformOrigin: 'top left',
    opacity: isDragging ? 0.5 : 1,
    position: 'absolute',
    cursor: 'move',
    whiteSpace: 'nowrap',
    fontSize: `${(field.fontSize || 20) * scale}px`,
  };

  return (
    <div ref={ref} style={style}>
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
    // Dimensions based on 83x37mm tag (664x296 dots)
    const viewboxWidth = 664;
    const viewboxHeight = 296;
    
    // Printable area dimensions
    const areaWidth = 260;
    const areaHeight = 296;

    // Middle non-printable strip
    const stripWidth = viewboxWidth - (areaWidth * 2);
    const stripHeight = 80;

    return (
        <svg
            className="absolute top-0 left-0 w-full h-full pointer-events-none"
            viewBox={`0 0 ${viewboxWidth} ${viewboxHeight}`}
            preserveAspectRatio="none"
        >
            <defs>
                 <mask id="dumbbell-mask">
                    <rect x="0" y="0" width={viewboxWidth} height={viewboxHeight} fill="white" />
                    <rect 
                        x={areaWidth} 
                        y={(viewboxHeight - stripHeight) / 2} 
                        width={stripWidth} 
                        height={stripHeight} 
                        fill="black"
                    />
                </mask>
            </defs>
            <rect 
                x="0" y="0" 
                width={viewboxWidth} height={viewboxHeight} 
                fill="currentColor"
                className="text-primary/5"
                mask="url(#dumbbell-mask)"
            />
            <rect 
                x="0" y="0" 
                width={viewboxWidth} height={viewboxHeight} 
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray="4 4"
                className="text-primary/20"
                mask="url(#dumbbell-mask)"
            />
        </svg>
    );
};


const TagPreview: React.FC<{
  layout: LabelLayout;
  scale: number;
  onMove: (id: string, x: number, y: number) => void;
}> = ({ layout, scale, onMove }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [{ canDrop, isOver }, drop] = useDrop(() => ({
    accept: ItemTypes.FIELD,
    drop(item: { id: string; x: number, y: number }, monitor) {
      const delta = monitor.getDifferenceFromInitialOffset();
      if (delta) {
        const left = Math.round(item.x + delta.x / scale);
        const top = Math.round(item.y + delta.y / scale);
        onMove(item.id, left, top);
      }
      return undefined;
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  }), [onMove, scale]);

  drop(ref);

  return (
    <div className="w-full relative bg-card border rounded-md overflow-hidden" style={{ aspectRatio: `${layout.widthDots} / ${layout.heightDots}` }}>
      <div ref={ref} className="relative w-full h-full">
         <DumbbellTagOutline />
        {layout.fields.map(field => (
          <DraggableField key={field.id} field={field} scale={scale} onMove={onMove} />
        ))}
      </div>
    </div>
  );
};


const TagEditor: React.FC<{ layout: LabelLayout; setLayout: (layout: LabelLayout) => void; }> = ({ layout, setLayout }) => {
  const { control, register, getValues, watch, reset } = useForm({
    defaultValues: layout,
  });

  const { fields, append, remove, update } = useFieldArray({
    control,
    name: 'fields',
  });

  // Watch for changes and update the parent state
  useEffect(() => {
    const subscription = watch((value) => {
        // We cast because watch returns DeepPartial, but we know it's the full form
        setLayout(value as LabelLayout);
    });
    return () => subscription.unsubscribe();
  }, [watch, setLayout]);

  // Reset the form if the layout prop changes from the outside (e.g., from drag-and-drop)
  useEffect(() => {
    reset(layout);
  }, [layout, reset]);

  return (
    <div className="space-y-4">
      {fields.map((item, index) => (
        <Card key={item.id} className="p-4">
          <div className="flex justify-between items-center mb-2">
            <h4 className="font-semibold">{getValues(`fields.${index}.id`)}</h4>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove(index)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input type="hidden" {...register(`fields.${index}.id`)} />
            <div className="space-y-1">
              <Label>X</Label>
              <Input type="number" {...register(`fields.${index}.x`, { valueAsNumber: true })} />
            </div>
            <div className="space-y-1">
              <Label>Y</Label>
              <Input type="number" {...register(`fields.${index}.y`, { valueAsNumber: true })} />
            </div>
             <div className="space-y-1">
              <Label>Data</Label>
              <Input {...register(`fields.${index}.data`)} />
            </div>
            <div className="space-y-1">
              <Label>Font Size</Label>
              <Input type="number" {...register(`fields.${index}.fontSize`, { valueAsNumber: true })} />
            </div>
             <div className="space-y-1">
              <Label>Rotation</Label>
                <Controller
                    control={control}
                    name={`fields.${index}.rotation`}
                    render={({ field }) => (
                         <select {...field} className="w-full h-10 border rounded-md px-2 bg-background">
                            <option value={0}>0°</option>
                            <option value={90}>90°</option>
                            <option value={180}>180°</option>
                            <option value={270}>270°</option>
                        </select>
                    )}
                />
            </div>
          </div>
        </Card>
      ))}
      <Button variant="outline" onClick={() => append({ id: `new-field-${Date.now()}`, type: 'text', x: 10, y: 10, data: 'New Text', fontSize: 20 })}>
        <PlusCircle className="mr-2 h-4 w-4" /> Add Text Field
      </Button>
    </div>
  );
};


function PrinterPageComponent() {
  const appReady = useAppReady();
  const { loadProducts, products, settings, addPrintHistory, printHistory } = useAppStore();
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
        setScale(containerWidth / layout.widthDots);
      }
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [layout.widthDots]);

  const handleMoveField = (id: string, x: number, y: number) => {
    setLayout(
      produce(draft => {
        const field = draft.fields.find(f => f.id === id);
        if (field) {
          field.x = x;
          field.y = y;
        }
      })
    );
  };
  
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
    <DndProvider backend={HTML5Backend}>
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
                <TagPreview layout={layout} scale={previewScale} onMove={handleMoveField} />
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
    </DndProvider>
  );
}

export default function PrinterPage() {
    const [isMounted, setIsMounted] = useState(false);
    useEffect(() => setIsMounted(true), []);
    if (!isMounted) return null;
    return <PrinterPageComponent />;
}
