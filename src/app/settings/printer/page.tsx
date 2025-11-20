
"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAppStore, Product } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Loader2, Printer, XCircle, CheckCircle, History, Repeat, QrCode, PlusCircle, Trash2, Text, Cog, Move, ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { LabelLayout, LabelField, generateZplFromLayout, sendZplToPrinter, checkZebraBrowserPrint } from '@/lib/zebra-printer';
import { format } from 'date-fns';
import QRCode from 'qrcode.react';
import { Label } from '@/components/ui/label';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { Select, SelectContent, SelectTrigger, SelectValue, SelectItem } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Form, FormItem } from '@/components/ui/form';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { useRouter } from 'next/navigation';

const ItemTypes = {
  FIELD: 'field',
};

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
                <button
                  key={product.sku}
                  onClick={() => handleSelect(product)}
                  className="w-full text-left p-2 rounded-md hover:bg-muted flex items-center gap-3"
                >
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
  layout: LabelLayout;
  product: Product | null;
  children: React.ReactNode;
}> = ({ field, layout, product, children }) => {
  const [{ isDragging }, drag] = useDrag(() => ({
    type: ItemTypes.FIELD,
    item: { id: field.id, x: field.x, y: field.y },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }));

  const left = (field.x / layout.widthDots) * 100;
  const top = (field.y / layout.heightDots) * 100;

  return (
    <div
      ref={drag}
      style={{ left: `${left}%`, top: `${top}%`, opacity: isDragging ? 0.5 : 1 }}
      className="absolute cursor-move"
      role="Handle"
    >
      {children}
    </div>
  );
};

const DumbbellTagOutline = () => (
    <svg
      className="absolute top-0 left-0 w-full h-full"
      viewBox="0 0 664 296" // Use dot dimensions for viewBox
      preserveAspectRatio="none"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* The two main printable areas */}
      <rect x="1" y="1" width="280" height="294" stroke="#A1A1AA" strokeWidth="2" rx="10" />
      <rect x="383" y="1" width="280" height="294" stroke="#A1A1AA" strokeWidth="2" rx="10" />

      {/* The middle non-printable strip */}
      <rect x="281" y="110" width="102" height="76" fill="#F4F4F5" />
      <line x1="281" y1="110" x2="383" y2="110" stroke="#E4E4E7" strokeWidth="1" strokeDasharray="4 4" />
      <line x1="281" y1="186" x2="383" y2="186" stroke="#E4E4E7" strokeWidth="1" strokeDasharray="4 4" />
    </svg>
);


const TagPreview: React.FC<{ layout: LabelLayout; product: Product | null; onFieldMove: (id: string, x: number, y: number) => void; }> = ({ layout, product, onFieldMove }) => {
    const previewRef = useRef<HTMLDivElement>(null);

    const [, drop] = useDrop(() => ({
        accept: ItemTypes.FIELD,
        drop: (item: { id: string; x: number; y: number }, monitor) => {
            const delta = monitor.getDifferenceFromInitialOffset();
            if (!delta || !previewRef.current) return;

            const previewRect = previewRef.current.getBoundingClientRect();
            const scaleX = layout.widthDots / previewRect.width;
            const scaleY = layout.heightDots / previewRect.height;
            
            const newX = Math.round(item.x + delta.x * scaleX);
            const newY = Math.round(item.y + delta.y * scaleY);
            
            onFieldMove(item.id, newX, newY);
        },
    }), [layout, onFieldMove]);


    const aspectRatio = layout.widthDots / layout.heightDots;

    const replacePlaceholders = (template: string): string => {
        if (!product) return template;
        return template.replace(/\{(\w+)\}/g, (match, key) => {
            return (product as any)[key] !== undefined ? String((product as any)[key]) : match;
        });
    };

    return (
        <div className="p-4 bg-gray-200 rounded-lg flex items-center justify-center">
            <div 
                ref={previewRef}
                className="bg-white relative shadow-md" 
                style={{ width: '300px', height: `${300 / aspectRatio}px` }}
            >
                <DumbbellTagOutline />
                <div ref={drop} className="w-full h-full">
                {layout.fields.map(field => {
                    const resolvedData = replacePlaceholders(field.data);

                    if (field.type === 'text') {
                        return (
                            <DraggableField key={field.id} field={field} layout={layout} product={product}>
                                <div className="text-black font-sans group p-1 border border-transparent hover:border-dashed hover:border-blue-500">
                                   <Move className="absolute -top-2 -left-2 h-3 w-3 text-blue-500 opacity-0 group-hover:opacity-100" />
                                   <span style={{ fontSize: `${(field.fontSize || 20) * 0.4}px` }}>{resolvedData}</span>
                                </div>
                            </DraggableField>
                        );
                    }
                    if (field.type === 'qr') {
                        const qrSize = (field.qrMagnification || 2) * 20; // Approximate size
                        return (
                             <DraggableField key={field.id} field={field} layout={layout} product={product}>
                                <div className="group p-1 border border-transparent hover:border-dashed hover:border-blue-500">
                                  <Move className="absolute -top-2 -left-2 h-3 w-3 text-blue-500 opacity-0 group-hover:opacity-100" />
                                  <QRCode value={resolvedData} size={qrSize} level="H" renderAs="svg" />
                                </div>
                            </DraggableField>
                        );
                    }
                    return null;
                })}
                </div>
            </div>
        </div>
    );
};

const productPlaceholders = [
    '{sku}', '{name}', '{categoryId}', '{metalType}', '{karat}', '{metalWeightG}', '{wastagePercentage}', '{makingCharges}'
];

const TagEditor: React.FC<{
    layout: LabelLayout,
    setLayout: React.Dispatch<React.SetStateAction<LabelLayout>>
}> = ({ layout, setLayout }) => {
    const form = useForm({
        defaultValues: { fields: layout.fields }
    });

    const { register, control, watch, setValue, getValues } = form;

    const { fields, append, remove } = useFieldArray({
        control,
        name: "fields"
    });
    
    useEffect(() => {
        setValue("fields", layout.fields);
    }, [layout, setValue]);

    const addField = (type: 'text' | 'qr') => {
        const newField: LabelField = {
            id: `field-${Date.now()}`,
            type: type,
            x: 10,
            y: 10,
            data: type === 'text' ? 'New Text' : '{sku}',
            fontSize: 20,
            qrMagnification: 2
        };
        append(newField);
        setLayout(prev => ({...prev, fields: [...prev.fields, newField]}));
    };
    
    const removeField = (index: number) => {
        remove(index);
        setLayout(prev => ({...prev, fields: prev.fields.filter((_, i) => i !== index)}));
    };
    
    const updateFieldData = (index: number, key: keyof LabelField, value: any) => {
        const currentFields = getValues('fields');
        const updatedFields = currentFields.map((field, i) => {
            if (i === index) {
                return {...field, [key]: value};
            }
            return field;
        });
        setLayout(prev => ({...prev, fields: updatedFields as LabelField[]}));
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center"><Cog className="mr-2 h-5 w-5" />Tag Editor</CardTitle>
                <CardDescription>Customize the fields on your label. Use placeholders like `{'{sku}'}`.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex flex-wrap gap-2 mb-4">
                    {productPlaceholders.map(p => (
                        <Button key={p} variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(p)}>{p}</Button>
                    ))}
                </div>
                 <Separator className="my-4"/>
                <ScrollArea className="h-72">
                    <div className="space-y-4 pr-4">
                        {fields.map((field, index) => (
                            <div key={field.id} className="p-3 border rounded-md relative">
                                <Button variant="destructive" size="icon" className="absolute -top-3 -right-3 h-6 w-6" onClick={() => removeField(index)}><Trash2 className="h-4 w-4" /></Button>
                                <div className="grid grid-cols-2 gap-4">
                                     <Controller
                                        control={control}
                                        name={`fields.${index}.type`}
                                        render={({ field: { onChange, value } }) => (
                                           <FormItem><Label>Type</Label>
                                            <Select onValueChange={(val) => { onChange(val); updateFieldData(index, 'type', val); }} value={value} defaultValue={value}>
                                               <SelectTrigger><SelectValue/></SelectTrigger>
                                               <SelectContent><SelectItem value="text">Text</SelectItem><SelectItem value="qr">QR Code</SelectItem></SelectContent>
                                            </Select></FormItem>
                                        )}
                                    />
                                    <FormItem><Label>Content</Label><Input {...register(`fields.${index}.data`)} placeholder="e.g., {sku} or static text" onChange={e => updateFieldData(index, 'data', e.target.value)} /></FormItem>
                                    <FormItem><Label>X Position</Label><Input type="number" {...register(`fields.${index}.x`)} onChange={e => updateFieldData(index, 'x', parseInt(e.target.value, 10) || 0)} /></FormItem>
                                    <FormItem><Label>Y Position</Label><Input type="number" {...register(`fields.${index}.y`)} onChange={e => updateFieldData(index, 'y', parseInt(e.target.value, 10) || 0)} /></FormItem>
                                    {watch(`fields.${index}.type`) === 'text' && <FormItem><Label>Font Size</Label><Input type="number" {...register(`fields.${index}.fontSize`)} onChange={e => updateFieldData(index, 'fontSize', parseInt(e.target.value, 10) || 20)} /></FormItem>}
                                    {watch(`fields.${index}.type`) === 'qr' && <FormItem><Label>QR Size</Label><Input type="number" {...register(`fields.${index}.qrMagnification`)} onChange={e => updateFieldData(index, 'qrMagnification', parseInt(e.target.value, 10) || 2)} /></FormItem>}
                                </div>
                            </div>
                        ))}
                    </div>
                </ScrollArea>
            </CardContent>
            <CardFooter>
                 <Button variant="secondary" onClick={() => addField('text')}><Text className="mr-2 h-4 w-4"/> Add Text</Button>
                 <Button variant="secondary" className="ml-2" onClick={() => addField('qr')}><QrCode className="mr-2 h-4 w-4"/> Add QR</Button>
            </CardFooter>
        </Card>
    );
};

// 8 dots/mm at 203 dpi.
// Width: 83mm * 8 dots/mm = 664 dots.
// Height: 37mm * 8 dots/mm = 296 dots.
const defaultLayout: LabelLayout = {
    id: 'default-dumbbell-large',
    name: 'Default Dumbbell (83x37mm)',
    widthDots: 664,
    heightDots: 296,
    fields: [
        { id: 'sku-text-left', type: 'text', x: 70, y: 120, data: '{sku}', fontSize: 30 },
        { id: 'qr-left', type: 'qr', x: 450, y: 50, data: '{sku}', qrMagnification: 5 },
    ],
};

function PrinterPageComponent() {
  const appReady = useAppReady();
  const { loadProducts, addPrintHistory, printHistory } = useAppStore();
  const { toast } = useToast();
  const router = useRouter();

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [printerStatus, setPrinterStatus] = useState<'unknown' | 'connected' | 'disconnected'>('unknown');
  const [isCheckingStatus, setIsCheckingStatus] = useState(true);
  const [currentLayout, setCurrentLayout] = useState<LabelLayout>(defaultLayout);
  
  const handleFieldMove = (id: string, x: number, y: number) => {
    setCurrentLayout(prev => ({
        ...prev,
        fields: prev.fields.map(f => f.id === id ? {...f, x, y} : f)
    }));
  };

  useEffect(() => {
    if (appReady) {
      loadProducts();
    }
  }, [appReady, loadProducts]);

  const checkPrinterStatus = async () => {
    setIsCheckingStatus(true);
    try {
        await checkZebraBrowserPrint();
        setPrinterStatus('connected');
    } catch (error) {
        setPrinterStatus('disconnected');
    } finally {
        setIsCheckingStatus(false);
    }
  };

  useEffect(() => {
    checkPrinterStatus();
  }, []);

  const handlePrint = async (productToPrint: Product | null) => {
    if (!productToPrint) {
        toast({ title: "No Product Selected", description: "Please select a product to print.", variant: "destructive" });
        return;
    }
    setIsPrinting(true);
    try {
      const zpl = generateZplFromLayout(currentLayout, productToPrint);
      await sendZplToPrinter(zpl);
      toast({
        title: "Print Job Sent",
        description: `Label for ${productToPrint.sku} sent to the Zebra printer.`,
      });
      addPrintHistory(productToPrint.sku);
    } catch (error: any) {
      toast({
        title: "Printer Error",
        description: error.message || "Could not communicate with the Zebra printer.",
        variant: "destructive",
      });
       setPrinterStatus('disconnected');
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <div className="container mx-auto py-4 sm:py-8 space-y-8">
      <header>
         <Button variant="outline" onClick={() => router.back()} className="mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Settings
        </Button>
        <h1 className="text-3xl font-bold text-primary flex items-center"><Printer className="mr-3 h-8 w-8"/>Zebra Printer Hub</h1>
        <p className="text-muted-foreground">Build, preview, and print your jewelry tags.</p>
      </header>

      <Card>
        <CardHeader>
            <CardTitle>Printer Status</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row items-center gap-4">
             {isCheckingStatus ? (
                <div className="flex items-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin"/>Checking connection...</div>
            ) : printerStatus === 'connected' ? (
                <div className="flex items-center text-green-600"><CheckCircle className="mr-2 h-4 w-4"/>Connected to Zebra Browser Print</div>
            ) : (
                <div className="flex items-center text-destructive"><XCircle className="mr-2 h-4 w-4"/>Disconnected. Please ensure Zebra Browser Print is running.</div>
            )}
            <Button variant="outline" size="sm" onClick={checkPrinterStatus} disabled={isCheckingStatus}>
                <Repeat className="mr-2 h-4 w-4"/>Re-check Status
            </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
            <Card>
                <CardHeader>
                    <CardTitle>1. Select Product</CardTitle>
                </CardHeader>
                <CardContent>
                     <ProductSearch onSelect={setSelectedProduct} selectedProduct={selectedProduct}/>
                </CardContent>
            </Card>
            <div className="mt-8">
                <TagEditor layout={currentLayout} setLayout={setCurrentLayout} />
            </div>
        </div>

        <div className="sticky top-8 space-y-8">
            <Card>
                <CardHeader>
                    <CardTitle>2. Preview & Print</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <TagPreview layout={currentLayout} product={selectedProduct} onFieldMove={handleFieldMove} />
                </CardContent>
                <CardFooter className="flex-col gap-4">
                    <Button 
                    className="w-full" 
                    size="lg"
                    onClick={() => handlePrint(selectedProduct)}
                    disabled={!selectedProduct || isPrinting || printerStatus !== 'connected'}
                    >
                    {isPrinting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Printer className="mr-2 h-4 w-4"/>}
                    Print Tag
                    </Button>
                </CardFooter>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Print History</CardTitle>
                    <CardDescription>A log of the most recently printed tags.</CardDescription>
                </CardHeader>
                <CardContent>
                    <ScrollArea className="h-64">
                        {printHistory.length > 0 ? (
                            <div className="space-y-2">
                                {printHistory.map(entry => (
                                    <div key={entry.timestamp} className="flex justify-between items-center p-2 rounded-md hover:bg-muted">
                                        <div>
                                            <p className="font-semibold font-mono">{entry.sku}</p>
                                            <p className="text-xs text-muted-foreground">{format(new Date(entry.timestamp), 'PPpp')}</p>
                                        </div>
                                        <Button variant="outline" size="sm" onClick={() => handlePrint({ sku: entry.sku } as Product)} disabled={isPrinting || printerStatus !== 'connected'}>
                                            <Repeat className="mr-2 h-3 w-3"/> Reprint
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center text-muted-foreground py-10">
                                <History className="mx-auto h-12 w-12 mb-4" />
                                <p>No print history yet.</p>
                            </div>
                        )}
                    </ScrollArea>
                </CardContent>
            </Card>
        </div>
      </div>
    </div>
  );
}

export default function PrinterPage() {
    return (
        <DndProvider backend={HTML5Backend}>
            <PrinterPageComponent />
        </DndProvider>
    );
}

    