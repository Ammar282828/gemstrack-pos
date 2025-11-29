
"use client";

import React, { useState } from 'react';
import { useAppStore, MetalType, KaratValue } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Calculator, Download, RefreshCcw, Sparkles, Send } from 'lucide-react';
import { format } from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { generateQuotationFlow } from '@/ai/flows/generate-quotation-flow';

// Helper to calculate costs locally for arbitrary values
function calculateQuotationCost(
    weightG: number,
    metalType: MetalType,
    karat: KaratValue,
    goldRatePerGram: number,
    makingCharges: number,
    wastagePercentage: number,
    stoneCharges: number,
    diamondCharges: number,
    miscCharges: number
) {
    let metalCost = 0;
    if (metalType === 'gold') {
        metalCost = weightG * goldRatePerGram;
    } 
    
    const wastageCost = metalCost * (wastagePercentage / 100);
    const total = metalCost + wastageCost + makingCharges + stoneCharges + diamondCharges + miscCharges;
    
    return {
        metalCost,
        wastageCost,
        total
    };
}

export default function QuotationGenerator() {
    const appReady = useAppReady();
    const settings = useAppStore(state => state.settings);
    const { toast } = useToast();

    const [activeTab, setActiveTab] = useState<'manual' | 'ai'>('manual');

    // AI State
    const [aiInput, setAiInput] = useState('');
    const [isAiLoading, setIsAiLoading] = useState(false);
    const [aiResponse, setAiResponse] = useState<any>(null);

    // Product Details State (Manual)
    const [productName, setProductName] = useState('');
    const [metalType, setMetalType] = useState<MetalType>('gold');
    const [karat, setKarat] = useState<KaratValue>('21k');
    const [makingCharges, setMakingCharges] = useState<number>(0);
    const [wastagePercentage, setWastagePercentage] = useState<number>(0);
    const [stoneCharges, setStoneCharges] = useState<number>(0);
    const [diamondCharges, setDiamondCharges] = useState<number>(0);
    const [miscCharges, setMiscCharges] = useState<number>(0);

    // Range Config State (Manual)
    const [currentRate, setCurrentRate] = useState<number>(0); 
    const [weightMin, setWeightMin] = useState<number>(0);
    const [weightMax, setWeightMax] = useState<number>(0);

    // Initialize current rate from settings
    React.useEffect(() => {
        if (appReady && settings) {
            let rate = 0;
            if (karat === '24k') rate = settings.goldRatePerGram24k;
            else if (karat === '22k') rate = settings.goldRatePerGram22k;
            else if (karat === '21k') rate = settings.goldRatePerGram21k;
            else if (karat === '18k') rate = settings.goldRatePerGram18k;
            setCurrentRate(rate);
        }
    }, [appReady, settings, karat]);

    const generateRangeData = () => {
        const rows = [];
        if (weightMin > 0) {
            rows.push({
                label: "Lowest Estimate",
                weight: weightMin,
                ...calculateQuotationCost(weightMin, metalType, karat, currentRate, makingCharges, wastagePercentage, stoneCharges, diamondCharges, miscCharges)
            });
        }
        if (weightMax > 0 && weightMax > weightMin) {
            rows.push({
                label: "Highest Estimate",
                weight: weightMax,
                ...calculateQuotationCost(weightMax, metalType, karat, currentRate, makingCharges, wastagePercentage, stoneCharges, diamondCharges, miscCharges)
            });
        }
        return rows;
    };

    const tableData = generateRangeData();

    // --- PDF Generation Logic ---
    const generatePDF = async (productsData: any[], isAiMode: boolean) => {
        const doc = new jsPDF();
        const pageHeight = doc.internal.pageSize.height;
        const pageWidth = doc.internal.pageSize.width;
        const margin = 14;
        
        // 1. Header Section (Logo & Shop Info)
        const logoUrl = settings.shopLogoUrl || settings.shopLogoUrlBlack;
        
        if (logoUrl) {
            try {
                // Load image asynchronously to ensure it renders
                const img = new Image();
                img.src = logoUrl;
                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = reject;
                });
                
                // Calculate aspect ratio to fit within 30x30 box while maintaining proportions
                const maxWidth = 40;
                const maxHeight = 30;
                let width = img.width;
                let height = img.height;
                
                if (width > height) {
                    if (width > maxWidth) {
                        height *= maxWidth / width;
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width *= maxHeight / height;
                        height = maxHeight;
                    }
                }

                doc.addImage(img, 'PNG', margin, 10, width, height);
            } catch (e) {
                console.error("Could not add logo to PDF", e);
            }
        }

        // Shop Name & Address
        doc.setFontSize(20);
        doc.setFont("helvetica", "bold");
        doc.text("QUOTATION", pageWidth - margin, 20, { align: 'right' });
        
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.text(settings.shopName || "Jewelry Shop", pageWidth - margin, 28, { align: 'right' });
        doc.text(format(new Date(), 'PPP'), pageWidth - margin, 34, { align: 'right' });

        let yPos = 50;

        // 2. Iterate through Products
        const productsToPrint = isAiMode ? productsData : [{
            productName: productName || "Custom Item",
            options: productsData.map(row => ({
                optionName: row.label,
                weightG: row.weight,
                karat: karat,
                makingCharges: makingCharges,
                wastagePercentage: wastagePercentage,
                stoneCharges: stoneCharges,
                diamondCharges: diamondCharges,
                miscCharges: miscCharges,
                estimatedTotal: row.total
            }))
        }];

        productsToPrint.forEach((product: any) => {
            // Product Header Box
            doc.setFillColor(240, 240, 240); 
            doc.rect(margin, yPos, pageWidth - (margin * 2), 8, 'F');
            
            doc.setFontSize(11);
            doc.setFont("helvetica", "bold");
            doc.setTextColor(0, 0, 0);
            doc.text(product.productName, margin + 2, yPos + 5.5);
            
            yPos += 8;

            // Table for this product's options
            const body = product.options.map((opt: any) => [
                opt.optionName,
                `${opt.weightG.toFixed(3)} g`,
                opt.karat,
                `${opt.wastagePercentage}%`,
                opt.makingCharges ? opt.makingCharges.toLocaleString() : '-',
                opt.stoneCharges ? opt.stoneCharges.toLocaleString() : '-',
                opt.diamondCharges ? opt.diamondCharges.toLocaleString() : '-',
                opt.estimatedTotal.toLocaleString()
            ]);

            autoTable(doc, {
                startY: yPos,
                head: [['Option', 'Weight', 'Karat', 'Wastage', 'Making', 'Stones', 'Diamond', 'Total']],
                body: body,
                theme: 'plain', 
                styles: { fontSize: 9, cellPadding: 3 },
                headStyles: { 
                    fillColor: [255, 255, 255], 
                    textColor: [0, 0, 0], 
                    fontStyle: 'bold',
                    lineWidth: { bottom: 0.5 },
                    lineColor: [0, 0, 0]
                },
                bodyStyles: {
                    lineWidth: { bottom: 0.1 },
                    lineColor: [200, 200, 200]
                },
                columnStyles: {
                    7: { halign: 'right', fontStyle: 'bold' }, // Total
                    6: { halign: 'right' }, // Diamond
                    5: { halign: 'right' }, // Stones
                    4: { halign: 'right' }, // Making
                    3: { halign: 'right' }, // Wastage
                    1: { halign: 'right' }  // Weight
                },
                margin: { left: margin, right: margin },
            });

            // @ts-ignore
            yPos = doc.lastAutoTable.finalY + 10; 
        });

        // 3. Footer (Matching invoice style)
        const footerStartY = pageHeight - 35;
        const guaranteesText = "Gold used is independently tested & verified by Swiss Lab Ltd., confirming 21k (0.875 fineness). Crafted exclusively from premium ARY GOLD.";
        const contacts = [
            { name: "Murtaza", number: "0333 2275190" }, { name: "Muhammad", number: "0300 8280896" },
            { name: "Huzaifa", number: "0335 2275553" }, { name: "Ammar", number: "0326 2275554" },
        ];

        // Separator line
        doc.setLineWidth(0.2);
        doc.setDrawColor(150);
        doc.line(margin, footerStartY - 5, pageWidth - margin, footerStartY - 5);

        // Guarantees
        doc.setFontSize(7);
        doc.setTextColor(100);
        doc.text(guaranteesText, margin, footerStartY, { maxWidth: pageWidth - (margin * 2) });

        // Contacts
        let contactX = margin;
        const contactY = footerStartY + 10;
        doc.setFontSize(8);
        doc.setTextColor(0, 0, 0);
        doc.setFont("helvetica", "bold");
        doc.text("Contact Us:", margin, contactY);
        
        // Simple contact listing
        const contactText = contacts.map(c => `${c.name}: ${c.number}`).join("  |  ");
        doc.setFont("helvetica", "normal");
        doc.text(contactText, margin, contactY + 5);

        doc.save(`Quotation-${isAiMode ? 'AI' : 'Manual'}.pdf`);
        toast({ title: "PDF Downloaded", description: "Quotation generated successfully." });
    };

    const handleAiSubmit = async () => {
        if (!aiInput.trim()) return;
        setIsAiLoading(true);
        try {
            const result = await generateQuotationFlow({
                userRequest: aiInput,
                currentGoldRate24k: settings.goldRatePerGram24k,
                currentGoldRate22k: settings.goldRatePerGram22k,
                currentGoldRate21k: settings.goldRatePerGram21k,
                currentGoldRate18k: settings.goldRatePerGram18k,
            });
            setAiResponse(result);
        } catch (error) {
            console.error(error);
            toast({ title: "AI Error", description: "Could not generate quotation options.", variant: "destructive" });
        } finally {
            setIsAiLoading(false);
        }
    };

    return (
        <div className="container mx-auto py-6 space-y-6">
            <header className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-primary flex items-center">
                        <Calculator className="mr-3 h-8 w-8" /> Quotation Generator
                    </h1>
                    <p className="text-muted-foreground">Create dynamic price quotes manually or with AI.</p>
                </div>
                <div className="flex gap-2">
                    <Button variant={activeTab === 'manual' ? 'default' : 'outline'} onClick={() => setActiveTab('manual')}>Manual Range</Button>
                    <Button variant={activeTab === 'ai' ? 'default' : 'outline'} onClick={() => setActiveTab('ai')}><Sparkles className="mr-2 h-4 w-4"/> Ask AI</Button>
                </div>
            </header>

            {activeTab === 'manual' ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Manual Inputs Column */}
                <Card className="lg:col-span-1">
                    <CardHeader>
                        <CardTitle>Product Details</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label>Product Name</Label>
                            <Input placeholder="e.g., Bridal Set" value={productName} onChange={e => setProductName(e.target.value)} />
                        </div>
                        
                        <div className="space-y-2">
                            <Label>Gold Rate (per g)</Label>
                            <Input type="number" value={currentRate} onChange={e => setCurrentRate(parseFloat(e.target.value) || 0)} />
                        </div>

                        <div className="space-y-2">
                            <Label>Karat</Label>
                            <Select value={karat} onValueChange={(val: KaratValue) => setKarat(val)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="18k">18k</SelectItem>
                                    <SelectItem value="21k">21k</SelectItem>
                                    <SelectItem value="22k">22k</SelectItem>
                                    <SelectItem value="24k">24k</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Wastage %</Label>
                                <Input type="number" value={wastagePercentage} onChange={e => setWastagePercentage(parseFloat(e.target.value) || 0)} />
                            </div>
                            <div className="space-y-2">
                                <Label>Making Charges</Label>
                                <Input type="number" value={makingCharges} onChange={e => setMakingCharges(parseFloat(e.target.value) || 0)} />
                            </div>
                        </div>

                        <Separator />
                        <h4 className="font-semibold text-sm">Additional Charges</h4>
                        
                        <div className="grid grid-cols-3 gap-2">
                            <div className="space-y-2">
                                <Label className="text-xs">Stone</Label>
                                <Input type="number" className="h-8" value={stoneCharges} onChange={e => setStoneCharges(parseFloat(e.target.value) || 0)} />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-xs">Diamond</Label>
                                <Input type="number" className="h-8" value={diamondCharges} onChange={e => setDiamondCharges(parseFloat(e.target.value) || 0)} />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-xs">Misc</Label>
                                <Input type="number" className="h-8" value={miscCharges} onChange={e => setMiscCharges(parseFloat(e.target.value) || 0)} />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Range Config Column */}
                <Card className="lg:col-span-1">
                    <CardHeader>
                        <CardTitle>Weight Range</CardTitle>
                        <CardDescription>Enter the minimum and maximum weight.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label className="text-green-600 font-semibold">Lowest Weight (g)</Label>
                                <Input type="number" className="border-green-200 focus-visible:ring-green-500" value={weightMin || ''} onChange={e => setWeightMin(parseFloat(e.target.value) || 0)} />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-red-600 font-semibold">Highest Weight (g)</Label>
                                <Input type="number" className="border-red-200 focus-visible:ring-red-500" value={weightMax || ''} onChange={e => setWeightMax(parseFloat(e.target.value) || 0)} />
                            </div>
                        </div>
                    </CardContent>
                    <CardFooter>
                         <Button variant="outline" className="w-full" onClick={() => {
                             if (settings) {
                                 let rate = 0;
                                 if (karat === '24k') rate = settings.goldRatePerGram24k;
                                 else if (karat === '22k') rate = settings.goldRatePerGram22k;
                                 else if (karat === '21k') rate = settings.goldRatePerGram21k;
                                 else if (karat === '18k') rate = settings.goldRatePerGram18k;
                                 setCurrentRate(rate);
                             }
                         }}>
                            <RefreshCcw className="mr-2 h-4 w-4" /> Reset Rate to Current
                        </Button>
                    </CardFooter>
                </Card>

                {/* Manual Results Column */}
                <Card className="lg:col-span-1 lg:row-span-2">
                    <CardHeader>
                        <CardTitle>Quotation</CardTitle>
                        <CardDescription>Price range for the selected weights.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="border rounded-md">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Scenario</TableHead>
                                        <TableHead>Weight</TableHead>
                                        <TableHead className="text-right">Estimate</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {tableData.length > 0 ? tableData.map((row, index) => (
                                        <TableRow key={index} className={index === 0 ? "bg-green-50" : "bg-red-50"}>
                                            <TableCell className="font-medium">{row.label}</TableCell>
                                            <TableCell>{row.weight.toFixed(3)} g</TableCell>
                                            <TableCell className="text-right font-bold text-lg">{row.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                                        </TableRow>
                                    )) : (
                                        <TableRow>
                                            <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                                                Enter Lowest and Highest weights to see the range.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                        
                        {tableData.length >= 2 && (
                            <div className="mt-6 p-4 bg-primary/5 rounded-lg border border-primary/10 text-center">
                                <p className="text-sm text-muted-foreground uppercase tracking-wider mb-1">Estimated Price Range</p>
                                <p className="text-3xl font-bold text-primary">
                                    {tableData[0].total.toLocaleString()} - {tableData[tableData.length - 1].total.toLocaleString()}
                                </p>
                            </div>
                        )}
                    </CardContent>
                    <CardFooter className="pt-4">
                        <Button className="w-full" onClick={() => generatePDF(tableData, false)} disabled={tableData.length === 0}>
                            <Download className="mr-2 h-4 w-4" /> Download PDF Quote
                        </Button>
                    </CardFooter>
                </Card>
            </div>
            ) : (
            // --- AI View ---
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
                <Card className="h-full flex flex-col">
                    <CardHeader>
                        <CardTitle className="flex items-center"><Sparkles className="mr-2 h-5 w-5 text-purple-500"/> AI Quotation Assistant</CardTitle>
                        <CardDescription>Tell me what you need, e.g., "Give me 3 options for a 21k bridal set between 40 and 60 grams."</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 flex flex-col gap-4">
                        <div className="flex-1 border rounded-md p-4 bg-muted/20 overflow-y-auto">
                            {aiResponse ? (
                                <div className="space-y-4">
                                    <p className="text-lg font-medium text-primary">{aiResponse.summaryText}</p>
                                    
                                    {aiResponse.products.map((product: any, idx: number) => (
                                        <div key={idx} className="space-y-2">
                                            <h4 className="font-bold text-md border-b pb-1">{product.productName}</h4>
                                            {product.options.map((s: any, i: number) => (
                                                <div key={i} className="p-3 bg-card border rounded-md shadow-sm">
                                                    <div className="flex justify-between items-center mb-1">
                                                        <span className="font-medium">{s.optionName}</span>
                                                        <span className="text-green-600 font-bold">{s.estimatedTotal.toLocaleString()}</span>
                                                    </div>
                                                    <p className="text-sm text-muted-foreground mb-2">{s.description}</p>
                                                    <div className="text-xs grid grid-cols-2 gap-y-1 text-muted-foreground">
                                                        <span>Weight: {s.weightG}g</span>
                                                        <span>Karat: {s.karat}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50">
                                    <Sparkles className="h-12 w-12 mb-2" />
                                    <p>Ready to generate ideas...</p>
                                </div>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <Textarea 
                                placeholder="Describe your request..." 
                                value={aiInput}
                                onChange={e => setAiInput(e.target.value)}
                                className="min-h-[80px]"
                            />
                            <Button className="h-auto w-20" onClick={handleAiSubmit} disabled={isAiLoading}>
                                {isAiLoading ? <RefreshCcw className="h-4 w-4 animate-spin"/> : <Send className="h-4 w-4"/>}
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                <Card className="h-full flex flex-col justify-center items-center bg-muted/10 border-dashed">
                    {aiResponse ? (
                        <div className="text-center space-y-4 p-8">
                            <div className="bg-white p-6 rounded-lg shadow-lg max-w-md mx-auto border">
                                <h3 className="font-serif text-xl font-bold mb-4 text-center">QUOTATION</h3>
                                
                                {aiResponse.products.map((product: any, idx: number) => (
                                    <div key={idx} className="mb-4 text-left">
                                        <h4 className="font-bold text-sm mb-2">{product.productName}</h4>
                                        <table className="w-full text-left text-sm">
                                            <thead>
                                                <tr className="border-b">
                                                    <th className="py-1">Option</th>
                                                    <th className="py-1 text-right">Weight</th>
                                                    <th className="py-1 text-right">Price</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {product.options.map((s: any, i: number) => (
                                                    <tr key={i} className="border-b last:border-0">
                                                        <td className="py-1 pr-2">{s.optionName}</td>
                                                        <td className="py-1 text-right">{s.weightG}g</td>
                                                        <td className="py-1 text-right font-bold">
                                                            {s.estimatedTotal.toLocaleString()}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ))}
                            </div>
                            <Button size="lg" className="w-full max-w-xs" onClick={() => generatePDF(aiResponse.products, true)} disabled={!aiResponse || aiResponse.products.length === 0}>
                                <Download className="mr-2 h-4 w-4"/> Download PDF
                            </Button>
                        </div>
                    ) : (
                        <div className="text-center text-muted-foreground">
                            <Calculator className="h-16 w-16 mx-auto mb-4 opacity-20" />
                            <p>Generate a quotation with AI to see the preview here.</p>
                        </div>
                    )}
                </Card>
            </div>
            )}
        </div>
    );
}
