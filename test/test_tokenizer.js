const assert = require('assert');
const BigNumber = require('bignumber.js');
const { increaseEvmBlock, increaseEvmTime, createEVMSnapshot, restoreEVMSnapshot, toBytes32, assertApproximate } = require('./funcs');
const { toWei, fromWei, toWad, fromWad, infinity, Side } = require('./constants');
const { inspect, printFunding } = require('./funcs')
const { typicalPerp } = require('./perp.js')
const Tokenizer = artifacts.require('TokenizerImplV1.sol');

contract('tokenizer', accounts => {
    let tokenizer;
    let perp;
   
    const broker = accounts[9];
    const admin = accounts[0];
    const dev = accounts[1];

    const u1 = accounts[4];
    const u2 = accounts[5];
    const u3 = accounts[6];

    let snapshotId;

    beforeEach(async () => {
        snapshotId = await createEVMSnapshot();
            
        perp = typicalPerp(accounts, false);
        await perp.deploy();
        await perp.useDefaultGovParameters();
        await perp.usePoolDefaultParameters();
        tokenizer = await Tokenizer.new();
        await perp.globalConfig.addComponent(perp.perpetual.address, tokenizer.address);
        await tokenizer.initialize("USD -> BTC", "uBTC", perp.perpetual.address, 18);
    });

    afterEach(async function () {
        await restoreEVMSnapshot(snapshotId);
    });

    describe("vanilla", async () => {
        beforeEach(async () => {
            // index
            await perp.setIndexPrice(7000);
            const indexPrice = await perp.amm.indexPrice();
            assert.equal(fromWad(indexPrice.price), 7000);

            // approve
            await perp.collateral.transfer(u1, toWad(7000 * 1 * 3));
            await perp.collateral.transfer(u2, toWad(7000 * 10));
            await perp.collateral.transfer(u3, toWad(7000 * 10));
            await perp.collateral.approve(perp.perpetual.address, infinity, { from: u1 });
            await perp.collateral.approve(perp.perpetual.address, infinity, { from: u2 });
            await perp.collateral.approve(perp.perpetual.address, infinity, { from: u3 });

            // create amm
            await perp.perpetual.deposit(toWad(7000 * 1 * 3), { from: u1 });
            await perp.amm.createPool(toWad(1), { from: u1 });
        });

        it("mint + redeem - success", async () => {
            assertApproximate(assert, fromWad(await perp.collateral.balanceOf(perp.perpetual.address)), 7000 * 3);
            await perp.perpetual.deposit(toWad(7000 * 2), { from: u2 });
            assert.equal(fromWad(await perp.perpetual.marginBalance.call(u2)), 7000 * 2);
            assert.equal(fromWad(await perp.perpetual.markPrice.call()), 7000);
            assert.equal(fromWad(await perp.collateral.balanceOf(u2)), 7000 * 10 - 7000 * 2)

            await tokenizer.mint(toWad(1), { from: u2 });
            
            assert.ok(new BigNumber(await perp.perpetual.marginBalance.call(u2)).lte(toWad(7000)));
            assert.ok(new BigNumber(await perp.perpetual.marginBalance.call(tokenizer.address)).gte(toWad(7000)));
            assert.equal(fromWad(await tokenizer.balanceOf(u2)), 1);
            assert.equal(fromWad(await tokenizer.balanceOf(tokenizer.address)), 0);
            assert.equal(fromWad(await tokenizer.totalSupply()), 1);
            assert.equal(fromWad(await perp.positionSize(u2)), 1);
            assert.equal(fromWad(await perp.positionSize(tokenizer.address)), 1);
            assert.equal(await perp.positionSide(u2), Side.SHORT);
            assert.equal(await perp.positionSide(tokenizer.address), Side.LONG);

            await tokenizer.redeem(toWad(1), { from: u2 });
            
            // await inspect(u2, perp.perpetual, perp.proxy, perp.amm);
            // await inspect(tokenizer.address, perp.perpetual, perp.proxy, perp.amm);

            assertApproximate(assert, fromWad(await perp.perpetual.marginBalance.call(u2)), '14000');
            assert.equal(fromWad(await perp.perpetual.marginBalance.call(tokenizer.address)), 0);
            assert.equal(fromWad(await tokenizer.balanceOf(u2)), 0);
            assert.equal(fromWad(await tokenizer.balanceOf(tokenizer.address)), 0);
            assert.equal(fromWad(await tokenizer.totalSupply()), 0);
            assert.equal(fromWad(await perp.positionSize(u2)), 0);
            assert.equal(fromWad(await perp.positionSize(tokenizer.address)), 0);
            assert.equal(await perp.positionSide(u2), Side.FLAT);
            assert.equal(await perp.positionSide(tokenizer.address), Side.FLAT);

            await perp.perpetual.withdraw(toWad('13999.9999999999999999'), { from: u2 });

            assertApproximate(assert, fromWad(await perp.perpetual.marginBalance.call(u2)), '0');
            assertApproximate(assert, fromWad(await perp.collateral.balanceOf(u2)), '69999.9999999999999999')
            assertApproximate(assert, fromWad(await perp.collateral.balanceOf(perp.perpetual.address)), 7000 * 3);
        });

        it("mint without deposit - failed", async () => {
            try {
                await tokenizer.mint(toWad(1), { from: u2 });
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("unsafe"), error);
            }

            assert.equal(fromWad(await tokenizer.balanceOf(u2)), 0);
        });

        it("composite mint + redeem - success", async () => {
            assertApproximate(assert, fromWad(await perp.collateral.balanceOf(perp.perpetual.address)), 7000 * 3);
            await tokenizer.depositAndMint(toWad(7000 * 2), toWad(1), { from: u2 });

            assert.equal(fromWad(await perp.collateral.balanceOf(u2)), 7000 * 10 - 7000 * 2);
            const u2Margin1 = new BigNumber(await perp.perpetual.marginBalance.call(u2));
            assert.ok(u2Margin1.lte(toWad(7000)), u2Margin1.toFixed());
            const tpMargin1 = new BigNumber(await perp.perpetual.marginBalance.call(tokenizer.address));
            assert.ok(tpMargin1.gte(toWad(7000)), tpMargin1.toFixed());
            assert.equal(fromWad(await tokenizer.balanceOf(u2)), 1);
            assert.equal(fromWad(await tokenizer.balanceOf(tokenizer.address)), 0);
            assert.equal(fromWad(await tokenizer.totalSupply()), 1);
            assert.equal(fromWad(await perp.positionSize(u2)), 1);
            assert.equal(fromWad(await perp.positionSize(tokenizer.address)), 1);
            assert.equal(await perp.positionSide(u2), Side.SHORT);
            assert.equal(await perp.positionSide(tokenizer.address), Side.LONG);

            await tokenizer.redeemAndWithdraw(toWad(1), toWad('13999.9999999999999999'), { from: u2 });
            
            // await inspect(u2, perp.perpetual, perp.proxy, perp.amm);
            // await inspect(tokenizer.address, perp.perpetual, perp.proxy, perp.amm);

            assertApproximate(assert, fromWad(await perp.perpetual.marginBalance.call(u2)), '0');
            assert.equal(fromWad(await perp.perpetual.marginBalance.call(tokenizer.address)), 0);
            assert.equal(fromWad(await tokenizer.balanceOf(u2)), 0);
            assert.equal(fromWad(await tokenizer.balanceOf(tokenizer.address)), 0);
            assert.equal(fromWad(await tokenizer.totalSupply()), 0);
            assert.equal(fromWad(await perp.positionSize(u2)), 0);
            assert.equal(fromWad(await perp.positionSize(tokenizer.address)), 0);
            assert.equal(await perp.positionSide(u2), Side.FLAT);
            assert.equal(await perp.positionSide(tokenizer.address), Side.FLAT);

            assertApproximate(assert, fromWad(await perp.collateral.balanceOf(u2)), '69999.9999999999999999')
            assertApproximate(assert, fromWad(await perp.collateral.balanceOf(perp.perpetual.address)), 7000 * 3);
        });

        it("the 2nd mint if price keeps", async () => {
            await tokenizer.depositAndMint(toWad(7000 * 2), toWad(1), { from: u2 });

            assert.equal(fromWad(await perp.collateral.balanceOf(u2)), 7000 * 10 - 7000 * 2);
            const u2Margin1 = new BigNumber(await perp.perpetual.marginBalance.call(u2));
            assert.ok(u2Margin1.lte(toWad(7000)), u2Margin1.toFixed());
            const tpMargin1 = new BigNumber(await perp.perpetual.marginBalance.call(tokenizer.address));
            assert.ok(tpMargin1.gte(toWad(7000)), tpMargin1.toFixed());
            assert.equal(fromWad(await tokenizer.balanceOf(u2)), 1);
            assert.equal(fromWad(await tokenizer.balanceOf(tokenizer.address)), 0);
            assert.equal(fromWad(await tokenizer.totalSupply()), 1);
            assert.equal(fromWad(await perp.positionSize(u2)), 1);
            assert.equal(fromWad(await perp.positionSize(tokenizer.address)), 1);
            assert.equal(await perp.positionSide(u2), Side.SHORT);
            assert.equal(await perp.positionSide(tokenizer.address), Side.LONG);

            await tokenizer.depositAndMint(toWad(7000 * 2), toWad(1), { from: u3 });

            assert.equal(fromWad(await perp.collateral.balanceOf(u3)), 7000 * 10 - 7000 * 2);
            const u3Margin2 = new BigNumber(await perp.perpetual.marginBalance.call(u3));
            assert.ok(u3Margin2.lte(toWad(7000)), u3Margin2.toFixed());
            const tpMargin2 = new BigNumber(await perp.perpetual.marginBalance.call(tokenizer.address));
            assert.ok(tpMargin2.gte(toWad(14000)), tpMargin2.toFixed());
            assert.equal(fromWad(await tokenizer.balanceOf(u3)), 1);
            assert.equal(fromWad(await tokenizer.balanceOf(tokenizer.address)), 0);
            assert.equal(fromWad(await tokenizer.totalSupply()), 2);
            assert.equal(fromWad(await perp.positionSize(u3)), 1);
            assert.equal(fromWad(await perp.positionSize(tokenizer.address)), 2);
            assert.equal(await perp.positionSide(u3), Side.SHORT);
            assert.equal(await perp.positionSide(tokenizer.address), Side.LONG);

            await tokenizer.redeemAndWithdraw(toWad(1), toWad('13999.9999999999999999'), { from: u3 });
            await tokenizer.redeemAndWithdraw(toWad(1), toWad('13999.9999999999999999'), { from: u2 });

            assertApproximate(assert, fromWad(await perp.collateral.balanceOf(u3)), '69999.9999999999999999')
            assertApproximate(assert, fromWad(await perp.collateral.balanceOf(u2)), '69999.9999999999999999')
            assertApproximate(assert, fromWad(await perp.collateral.balanceOf(perp.perpetual.address)), 7000 * 3);
        });

        it("transfer the token", async () => {
            await tokenizer.depositAndMint(toWad(7000 * 2), toWad(1), { from: u2 });
            await tokenizer.transfer(u3, toWad(1), { from: u2 });
            assert.equal(fromWad(await tokenizer.balanceOf(u2)), 0);
            assert.equal(fromWad(await tokenizer.balanceOf(u3)), 1);
            assert.equal(fromWad(await tokenizer.balanceOf(tokenizer.address)), 0);
            assert.equal(fromWad(await tokenizer.totalSupply()), 1);
            assert.equal(fromWad(await perp.perpetual.marginBalance.call(u3)), 0);
        
            await tokenizer.redeem(toWad(1), { from: u3 });
            assert.equal(fromWad(await tokenizer.balanceOf(u3)), 0);
            assert.equal(fromWad(await tokenizer.balanceOf(tokenizer.address)), 0);
            assert.equal(fromWad(await tokenizer.totalSupply()), 0);

            assertApproximate(assert, fromWad(await perp.perpetual.marginBalance.call(u3)), 7000);
            assert.equal(fromWad(await perp.positionSize(u3)), 1);
            assert.equal(await perp.positionSide(u3), Side.LONG);
        });

        it("if price rises", async () => {
        });
        // it("if price drops", async () => {
        // });
        // it("if fr > 0", async () => {
        // });
        // it("if fr < 0", async () => {
        // });
    });
});
