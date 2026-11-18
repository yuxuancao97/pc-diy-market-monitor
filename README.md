# PC DIY Market Monitor

DRAM, NAND and graphics card prices for PC builders on one page, re-read from
public sources every hour.

## What it reads

| On the page | Source |
| --- | --- |
| DRAM, module and GDDR spot boards | [TrendForce DRAM price trends](https://www.trendforce.com/price/dram/dram_spot) |
| NAND wafer spot | [TrendForce NAND flash price trends](https://www.trendforce.com/price/flash/flash_spot) |
| Spot prices before this page began reading the boards | Copies of the same board on [dramexchange.com](https://www.dramexchange.com/) kept by the [Internet Archive](https://web.archive.org/web/*/https://www.dramexchange.com/) |
| 32GB DDR5 kit retail prices | [Capital & Compute memory prices](https://capitalandcompute.net/memory-prices/) |
| Graphics card prices against MSRP | [Tom's Hardware GPU price tracker](https://www.tomshardware.com/pc-components/gpus/lowest-gpu-prices-tracking), and the Internet Archive's copies of it |
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

`npm run backfill` rebuilds the two archive files from the Internet Archive.
It is run by hand and takes about half an hour the first time.

Node 20 or later, no dependencies.
