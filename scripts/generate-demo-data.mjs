// Entirely synthetic fixtures. This generator never reads a farm file.
import { mkdir, writeFile } from 'node:fs/promises';
import { phosphorusIndex, potassiumIndex, magnesiumIndex } from '../app/domain/soil-index.ts';

const output = new URL('../data/', import.meta.url);
await mkdir(output, { recursive: true });
const date = '2026-01-15';
const rectangle = (x, y, side) => ({ type: 'Polygon', coordinates: [[[x,y],[x+side,y],[x+side,y+side],[x,y+side],[x,y]]] });
const indexNumber = band => band === '2-' ? 1.7 : band === '2+' ? 2.3 : Number(band);
const metricDefinitions = [
  ['ph','pH','Core','pH'], ['phosphorus','Phosphorus','Core','mg/l'], ['potassium','Potassium','Core','mg/l'], ['magnesium','Magnesium','Core','mg/l'],
  ['organic-matter','Organic Matter','Core','%'], ['organic-carbon','Organic Carbon','Core','%'],
  ['clay','Clay','Texture','%'], ['sand','Sand','Texture','%'], ['silt','Silt','Texture','%'],
  ['boron','Boron','Trace','ppm'], ['copper','Copper','Trace','ppm'], ['iron','Iron','Trace','ppm'], ['manganese','Manganese','Trace','ppm'],
  ['molybdenum','Molybdenum','Trace','ppm'], ['sodium','Sodium','Trace','ppm'], ['sulphur','Sulphur','Trace','ppm'], ['zinc','Zinc','Trace','ppm'],
];
const measurement = (id, value, unit) => {
  const band = id === 'phosphorus' ? phosphorusIndex(value) : id === 'potassium' ? potassiumIndex(value) : id === 'magnesium' ? magnesiumIndex(value) : null;
  return { value, unit, method: id === 'phosphorus' ? 'Olsen P (synthetic)' : 'Synthetic demonstration; not a laboratory measurement', ...(band === null ? {} : { indexBand: band, indexValue: indexNumber(band) }) };
};
const makeResults = (field, grid) => {
  const p = 8 + field * 7 + grid * 2;
  const k = 80 + field * 45 + grid * 12;
  const clay = 17 + field * 3 + grid;
  const sand = 50 - field * 4 - grid;
  const values = { ph: 5.8 + field * 0.25 + grid * 0.08, phosphorus: p, potassium: k, magnesium: 65 + field * 28 + grid * 5, 'organic-matter': 3 + field + grid * 0.2, 'organic-carbon': 1.7 + field * 0.5 + grid * 0.1 };
  if (grid === 0 || grid === 3) Object.assign(values, { clay, sand, silt: 100-clay-sand, boron: 0.7+field*0.3, copper: 3+field, iron: 400+field*100, manganese: 20+grid*3, molybdenum: 0.12+field*0.03, sodium: 30+field*10, sulphur: 12+grid, zinc: 2+field*0.5 });
  return Object.fromEntries(metricDefinitions.filter(([id]) => values[id] !== undefined).map(([id,,,unit]) => [id, measurement(id, Number(values[id].toFixed(2)), unit)]));
};
const names = ['Demo Arable A','Demo Rotation B','Demo Grass C','Demo Untested D'];
const fields = [];
const grids = [];
for (let f = 0; f < 4; f++) {
  const id = `demo-field-${String.fromCharCode(97+f)}`;
  const x = (f % 2) * 0.0022;
  const y = Math.floor(f/2) * 0.0022;
  const crop = f === 2 ? 'Permanent grass' : f === 1 ? 'Grass ley' : 'Winter wheat';
  const results = [];
  for (let g = 0; g < 4; g++) {
    const metrics = f === 3 ? {} : makeResults(f,g);
    const gridId = `demo-grid-${f+1}-${g+1}`;
    const gx = x + (g % 2) * 0.0009;
    const gy = y + Math.floor(g/2) * 0.0009;
    grids.push({ id: gridId, fieldId: id, canonicalFieldId: id, fieldName: names[f], centroid: [gx+0.00045,gy+0.00045], geometry: rectangle(gx,gy,0.0009), areaHa: 1, ...(f===3 ? {} : {sampleId:`demo-sample-${f+1}-${g+1}`, sampleDate:date}), results:metrics });
    if (f !== 3) results.push({ date, dateSort:date, crop, samplingGridId:gridId, metrics });
  }
  if (f !== 3) for (const year of [2022,2024]) {
    const metrics = makeResults(f,1);
    metrics.phosphorus.value += year === 2022 ? 3 : 1;
    const pBand = phosphorusIndex(metrics.phosphorus.value);
    metrics.phosphorus.indexBand = pBand;
    metrics.phosphorus.indexValue = indexNumber(pBand);
    results.push({ date:`${year}-01-15`, dateSort:`${year}-01-15`, crop:f===1 ? 'Winter wheat' : crop, metrics });
  }
  // Planner anchors contain whole-field mathematical averages of the demo cells.
  if (f !== 3) {
    const p = [0,1,2,3].reduce((sum,g)=>sum+makeResults(f,g).phosphorus.value,0)/4;
    const k = [0,1,2,3].reduce((sum,g)=>sum+makeResults(f,g).potassium.value,0)/4;
    results.unshift({ date, dateSort:date, crop, pValue:p, kValue:k, pIndex:phosphorusIndex(p), kIndex:potassiumIndex(k), ph:6.1+f*0.2, metrics:makeResults(f,1) });
  }
  fields.push({ id, canonicalId:id, name:names[f], crop, areaHa:4, geometry:rectangle(x,y,0.0018), results });
}
const soil = { schemaVersion:'synthetic-demo-1', synthetic:true, generatedAt:'2026-01-01T00:00:00Z', sources:{workbook:'Synthetic demo generator',boundaries:'Invented schematic rectangles near 0°/0°; no real farm',grids:'Synthetic 1 ha-labelled demo cells (illustrative areas)'}, fields, grids,
  metrics:metricDefinitions.map(([id,name,category,unit])=>({id,name,category,categories:[category],units:[unit],methods:['Synthetic demonstration'],kind:'numeric',resultCount:fields.reduce((sum,f)=>sum+f.results.filter(r=>r.metrics?.[id]).length,0),gridResultCount:grids.filter(g=>g.results[id]).length,indexAvailable:['phosphorus','potassium','magnesium'].includes(id),gridIndexAvailable:['phosphorus','potassium','magnesium'].includes(id),boundaryPolicy:category==='Texture'?'cross-field':'field-constrained'})) };

const range = (low, central=low, high=central) => ({low,central,high});
const products = [
  ['demo-n','Example nitrogen fertiliser',{n:34.5},333],
  ['demo-p','Example phosphate fertiliser',{p2o5:46},777],
  ['demo-k','Example potash fertiliser',{k2o:60},444],
  ['demo-npk','Example NPK blend',{n:15,p2o5:15,k2o:15},555],
  ['demo-fym','Example cattle FYM',{n:0.6,p2o5:0.32,k2o:0.8},22],
].map(([id,name,nutrients,price])=>({id,name,category:id==='demo-fym'?'Organic':'Mineral',pricePerTonne:price,priceBasis:'INVENTED demo price: not a supplier quotation or market price',defaultUnit:id==='demo-fym'?'t/ha':'kg/ha',nutrients,
  effectiveness:{firstYearPAvailability:nutrients.p2o5?range(id==='demo-fym'?0.4:1,id==='demo-fym'?0.6:1,id==='demo-fym'?0.8:1):null,longTermPBuildRae:nutrients.p2o5?range(id==='demo-fym'?0.5:1,id==='demo-fym'?0.75:1,1):null,kAvailability:nutrients.k2o?range(0.8,0.9,1):null,evidenceClass:'farm_assumption',source:'Synthetic demo assumption',note:'Illustrative only; replace with batch-specific evidence'},
  cost:{materialPricePerTonne:price,haulagePerTonne:0,handlingPerTonne:0,spreadingPerTonne:0,spreadingPerHa:12,fixedPassCostPerHa:0,quotedBundledCost:null}, dataWarnings:['synthetic_price','uncalibrated_demo_effectiveness']}));
const crop = (f,year) => f===2 ? ['Permanent grass','Grass',0] : (year+f)%3===0 ? ['Spring barley','Barley',5.5] : (year+f)%3===1 ? ['Winter wheat','Wheat',7.5] : ['Faba beans','Beans',3.5];
const removal = group => group==='Wheat'? [6.5,5.5,1.2,9.5] : group==='Barley'?[8,5.5,1,12] : group==='Beans'?[11,12,1.5,10] : [0,0,0,0];
const nutrientFields = fields.map((field,f)=>({fieldId:field.id,canonicalId:field.id,fieldName:field.name,testDate:f===3?null:date,testDatePrecision:'day',rotations:[2026,2027,2028,2029].map(year=>{
  const [name,group,yieldTPerHa] = crop(f,year);
  const [grainP2o5KgPerT,grainK2oKgPerT,strawP2o5KgPerT,strawK2oKgPerT] = removal(group);
  return {year,crop:name,cropGroup:group,forecast:true,economicForecast:year>2026,fallbackComposite:false,includeInProjection:year===2026,yieldTPerHa,yieldSource:'Invented demo rotation and yield',yieldUncertaintyPct:25,yieldLabel:'Synthetic assumption',strawRemoved:group!=='Grass'&&f===0,strawTPerHa:group==='Grass'?0:2,offtake:{grainP2o5KgPerT,grainK2oKgPerT,strawP2o5KgPerT,strawK2oKgPerT}};
}),recordedApplications:f===1?[{id:'demo-recorded-fym',date:'2026-03-01',cropYear:2026,productId:'demo-fym',productName:'Example cattle FYM',rateKgHa:10000,evidence:'confirmed',nutrientsKgHa:{n:60,p2o5:32,k2o:80,so3:0,mgo:0,cao:0,neutralisingValue:0}}]:[]}));
const nutrient = { synthetic:true,schemaVersion:'synthetic-demo-1',generatedAt:'2026-01-01T00:00:00Z',modelAsAt:'2026-12-31',
  sources:{rotation:'Invented demo rotation',harvest:'Invented demo yields',recordedApplications:'Invented demo FYM entry',privateProducts:'None: no private products supplied',publicPrices:{label:'Invented prices, NOT market data',href:'https://ahdb.org.uk/GB-fertiliser-prices'},offtake:{label:'RB209 reference; confirm crop factors for use',href:'https://ahdb.org.uk/nutrient-management-guide-rb209'}},
  model:{indexBuildAllowanceKgHaPerYear:{index0:60,index1:30,source:'Illustrative allowance; review against RB209'},soilMass:{p2o5KgPerHaPerMgLAtFullRecovery:4.5,k2oKgPerHaPerMgLAtFullRecovery:2.4},recoveryRanges:{p:range(0.1,0.25,0.4),k:range(0.25,0.5,0.75),note:'Illustrative uncertainty, not a validated mass-to-soil-test conversion'},economics:{referenceCrop:'Wheat',referenceYieldTPerHa:8,priceUncertaintyPct:25,discountRatePct:5,cropValueDefaultsGbpPerTonne:{Wheat:200,Barley:180,Beans:250,Grass:0,Other:200},combinedCentralCapFraction:0.18,combinedHighCapFraction:0.35,responsePriorsTPerHaAt8T:{p:{index0:{central:0.9,high:2.1},index1:{central:0.36,high:1.6},index2:{central:0.02,high:0.2}},k:{index0:{central:1.1,high:3},index1:{central:0.36,high:1.5},index2Minus:{central:0.02,high:0.3}}},note:'Uncalibrated planning priors. Demo money and yields are invented, not advice.'}},products,fields:nutrientFields };
for (const [name,data] of [['soil-data.json',soil],['nutrient-data.json',nutrient]]) await writeFile(new URL(name,output), JSON.stringify(data,null,2)+'\n');
console.log('Generated synthetic demo: 4 invented fields, 16 grids, 17 metrics and 5 invented products. No farm files read.');
