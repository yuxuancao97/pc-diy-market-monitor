# PC DIY Market Monitor

DRAM, NAND and graphics card prices for PC builders on one page, re-read from
public sources every hour.

## What it reads

| On the page | Source |
| --- | --- |
| DRAM, module and GDDR spot boards | [TrendForce DRAM price trends](https://www.trendforce.com/price/dram/dram_spot) |
| NAND wafer spot | [TrendForce NAND flash price trends](https://www.trendforce.com/price/flash/flash_spot) |
| DDR4 8Gb spot history | [Capital & Compute price history](https://capitalandcompute.net/memory-prices/history/) |
| 32GB DDR5 kit retail prices | [Capital & Compute memory prices](https://capitalandcompute.net/memory-prices/) |
| Graphics card prices against MSRP | [ComputingForGeeks GPU prices](https://computingforgeeks.com/gpu-prices/) |
| Median premium at Newegg | [TechFuelHQ GPU Price Index](https://techfuelhq.com/data/gpu-price-index/), CC BY 4.0 |
| Contract price forecasts | TrendForce press releases, entered by hand |

Every row in `site/data` names the page it came from. The figures belong to
their publishers; this page only shows them side by side with a link back.

## Run it

```bash
npm test
```

```bash
npm run fetch
```

```bash
npm run serve
```

Node 20 or later, no dependencies.
