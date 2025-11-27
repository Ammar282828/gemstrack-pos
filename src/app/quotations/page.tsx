
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
import { Calculator, Download, RefreshCcw, Sparkles, Mic, Send } from 'lucide-react';
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

    // Tabs state
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
        
        // Lowest Estimate
        if (weightMin > 0) {
            rows.push({
                label: "Lowest Estimate",
                weight: weightMin,
                ...calculateQuotationCost(weightMin, metalType, karat, currentRate, makingCharges, wastagePercentage, stoneCharges, diamondCharges, miscCharges)
            });
        }

        // Highest Estimate (only if different from min)
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

    const handleDownloadPDF = (data: any[], titleSuffix: string, customTitle?: string) => {
        const doc = new jsPDF();
        
        doc.setFontSize(18);
        doc.text(settings.shopName || "Quotation", 14, 20);
        
        doc.setFontSize(12);
        doc.text(`Product: ${customTitle || productName || "Custom Item"}`, 14, 30);
        doc.text(`Date: ${format(new Date(), 'PP')}`, 14, 36);
        
        if (activeTab === 'manual') {
             doc.text(`Gold Rate Used: ${currentRate.toLocaleString()} /g`, 14, 42);
             doc.text("Fixed Charges:", 14, 50);
             doc.setFontSize(10);
             doc.text(`Karat: ${karat} | Making: ${makingCharges}`, 14, 56);
             doc.text(`Wastage: ${wastagePercentage}% | Stone/Diamond/Misc: ${stoneCharges + diamondCharges + miscCharges}`, 14, 62);
        } else if (activeTab === 'ai' && aiResponse) {
             doc.setFontSize(10);
             doc.text(aiResponse.summaryText || "AI Generated Options", 14, 45);
        }

        const tableBody = data.map(row => [
            row.label || row.scenarioName,
            typeof row.weight === 'number' ? row.weight.toFixed(3) + ' g' : row.weightG + ' g',
            // Handle different structure between manual calc and AI output
            (row.metalCost !== undefined ? row.metalCost : (row.weightG * 0)).toLocaleString(undefined, { maximumFractionDigits: 0 }), // AI output might need raw metal cost calc logic if not provided directly, for now simplifying
            (row.wastageCost !== undefined ? row.wastageCost : (row.estimatedTotal * 0.1)).toLocaleString(undefined, { maximumFractionDigits: 0 }), // approx for AI
            (row.total !== undefined ? row.total : row.estimatedTotal).toLocaleString(undefined, { maximumFractionDigits: 0 })
        ]);

        // For AI table, we might have different columns
        const head = activeTab === 'manual' 
            ? [['Scenario', 'Weight', 'Metal Cost', 'Wastage Cost', 'Total Estimate']]
            : [['Option', 'Weight', 'Karat', 'Charges', 'Total Estimate']];
            
        const aiTableBody = data.map(row => [
            row.scenarioName,
            row.weightG + 'g',
            row.karat,
            (row.makingCharges + (row.stoneCharges||0) + (row.diamondCharges||0)).toLocaleString(),
            row.estimatedTotal.toLocaleString()
        ]);

        autoTable(doc, {
            startY: activeTab === 'manual' ? 70 : 55,
            head: activeTab === 'manual' ? head : head,
            body: activeTab === 'manual' ? tableBody : aiTableBody,
            theme: 'grid',
            headStyles: { fillColor: [39, 174, 96] }, 
        });

        doc.save(`Quotation-${titleSuffix}.pdf`);
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
                        <Button className="w-full" onClick={() => handleDownloadPDF(tableData, 'Range')} disabled={tableData.length === 0}>
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
                                    <div className="space-y-2">
                                        {aiResponse.scenarios.map((s: any, i: number) => (
                                            <div key={i} className="p-3 bg-card border rounded-md shadow-sm">
                                                <div className="flex justify-between items-center mb-1">
                                                    <h4 className="font-bold">{s.scenarioName}</h4>
                                                    <span className="text-green-600 font-bold">{s.estimatedTotal.toLocaleString()}</span>
                                                </div>
                                                <p className="text-sm text-muted-foreground mb-2">{s.description}</p>
                                                <div className="text-xs grid grid-cols-2 gap-y-1 text-muted-foreground">
                                                    <span>Weight: {s.weightG}g</span>
                                                    <span>Karat: {s.karat}</span>
                                                    <span>Making: {s.makingCharges}</span>
                                                    <span>Wastage: {s.wastagePercentage}%</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
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
                            <div className="bg-white p-6 rounded-lg shadow-lg max-w-sm mx-auto border">
                                <h3 className="font-serif text-xl font-bold mb-4">{settings.shopName || "Quotation"}</h3>
                                <p className="text-sm text-muted-foreground mb-4">AI Generated Estimate</p>
                                <table className="w-full text-left text-sm">
                                    <thead>
                                        <tr className="border-b">
                                            <th className="py-2">Option</th>
                                            <th className="py-2 text-right">Price</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {aiResponse.scenarios.map((s: any, i: number) => (
                                            <tr key={i} className="border-b last:border-0">
                                                <td className="py-2 pr-4">
                                                    <div className="font-medium">{s.scenarioName}</div>
                                                    <div className="text-xs text-muted-foreground">{s.weightG}g | {s.karat}</div>
                                                </td>
                                                <td className="py-2 text-right font-bold">
                                                    {s.estimatedTotal.toLocaleString()}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <Button size="lg" className="w-full max-w-xs" onClick={() => handleDownloadPDF(aiResponse.scenarios, 'AI-Options', aiInput)}>
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
