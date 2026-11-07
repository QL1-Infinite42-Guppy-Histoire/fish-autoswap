// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Test-only mocks for the local smoke test. Their runtime code is copied
// onto the REAL mainnet addresses (FISH / router / factory / a target
// token) inside a throwaway ganache chain via evm_setAccountCode, so the
// mocks must not depend on constructor-set state: everything they need
// is a constant or is set later through normal calls (e.g. mint).

interface IMockERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function mint(address to, uint256 amount) external;
}

contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function decimals() external pure returns (uint8) {
        return 18;
    }

    function symbol() external pure returns (string memory) {
        return "MOCK";
    }

    function name() external pure returns (string memory) {
        return "Mock Token";
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "MockERC20: balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "MockERC20: balance");
        uint256 allow = allowance[from][msg.sender];
        require(allow >= amount, "MockERC20: allowance");
        if (allow != type(uint256).max) allowance[from][msg.sender] = allow - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockFactory {
    function getPair(address tokenA, address tokenB) external pure returns (address) {
        if (tokenA == address(0) || tokenB == address(0) || tokenA == tokenB) return address(0);
        return address(0x00000000000000000000000000000000000000AA);
    }
}

contract MockRouter {
    address public constant WETH_ADDR = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    function WETH() external pure returns (address) {
        return WETH_ADDR;
    }

    function factory() external pure returns (address) {
        return 0x3157C6AcA800D507af95Ab1466adBA3A6F11eE1a;
    }

    function _out(uint256 amountIn, address next) internal pure returns (uint256) {
        // Hop into the native sentinel pays out in wei scale; token hops pay 2x.
        if (next == WETH_ADDR) return (amountIn * 2) / 1e12;
        return amountIn * 2;
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        pure
        returns (uint256[] memory amounts)
    {
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i = 0; i + 1 < path.length; i++) {
            amounts[i + 1] = _out(amounts[i], path[i + 1]);
        }
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256
    ) external returns (uint256[] memory amounts) {
        amounts = this.getAmountsOut(amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, "MockRouter: slippage");
        require(
            IMockERC20(path[0]).transferFrom(msg.sender, address(this), amountIn),
            "MockRouter: pull failed"
        );
        IMockERC20(path[path.length - 1]).mint(to, amounts[amounts.length - 1]);
    }

    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256
    ) external returns (uint256[] memory amounts) {
        amounts = this.getAmountsOut(amountIn, path);
        uint256 ethOut = amounts[amounts.length - 1];
        require(ethOut >= amountOutMin, "MockRouter: slippage");
        require(
            IMockERC20(path[0]).transferFrom(msg.sender, address(this), amountIn),
            "MockRouter: pull failed"
        );
        (bool ok, ) = payable(to).call{value: ethOut}("");
        require(ok, "MockRouter: eth send failed");
    }
}
