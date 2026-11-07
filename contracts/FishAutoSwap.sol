// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title FishAutoSwap
/// @notice Once a day, a keeper triggers a swap of the FISH you received
///         that morning into a token you chose, at a percent / daily cap
///         / slippage you registered yourself.
///
/// Trust model (deliberately minimal):
///  - The contract NEVER holds output tokens: swap proceeds are sent by
///    the router straight to your own address (`to = user`).
///  - The only FISH it can ever touch is FISH you approved to it
///    (ERC-20 allowance), and per day at most: that day's minted amount
///    x your percent, capped by your daily cap, your balance and your
///    remaining allowance.
///  - It can only swap into the target token YOU registered, along a
///    2- or 3-hop path validated on-chain (FISH first, your target
///    last, every hop's pair must exist).
///  - The keeper can only call `execute` (at most once per user per
///    UTC day). The owner can only set the keeper and pause/unpause.
///  - There is NO withdraw function at all. Nothing can be taken out.
///
/// Native [42] convention:
///  - In a stored config, `targetToken == address(0)` means the native
///    coin [42]. Registering with the 0xEeee...EEeE sentinel is accepted
///    and normalized to address(0).
///  - Inside a swap path, the native coin is represented by the
///    router's WETH() value, which on this DEX is the 0xEeee...EEeE
///    sentinel. For a native target the last path element must equal
///    router.WETH().

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IUniswapV2Router {
    function factory() external view returns (address);
    function WETH() external view returns (address);
    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts);
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

contract FishAutoSwap {
    // ---- Constants: 42 Chain mainnet (EVM chain ID 421018) ----
    IERC20 public constant FISH = IERC20(0x2c32120a12B754272d9E85C57F64b50cA2C43513);
    IUniswapV2Router public constant ROUTER = IUniswapV2Router(0xBF07dFE35746894bAe373f63f4Bf2379F9BaFEc0);
    IUniswapV2Factory public constant FACTORY = IUniswapV2Factory(0x3157C6AcA800D507af95Ab1466adBA3A6F11eE1a);
    /// @notice Path/config sentinel for the native coin [42] on this DEX.
    address public constant NATIVE = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    uint256 public constant MAX_SLIPPAGE_BPS = 5000; // 50%
    uint256 private constant BPS = 10000;

    // ---- Roles ----
    address public owner;
    address public keeper;
    bool public paused;

    // ---- Per-user config ----
    struct Config {
        address targetToken; // address(0) = native [42]
        uint256 percentBps; // share of that day's minted FISH, 1..10000
        uint256 dailyCap; // max FISH per day, in wei (> 0)
        uint256 slippageBps; // 0..MAX_SLIPPAGE_BPS
        bool enabled;
        bool registered;
    }

    mapping(address => Config) private _configs;
    mapping(address => uint256) public lastExecutedDay; // UTC day number
    address[] private _users;
    mapping(address => bool) private _inUsers;

    // ---- Reentrancy guard ----
    uint256 private _locked = 1;
    modifier nonReentrant() {
        require(_locked == 1, "FishAutoSwap: reentrant call");
        _locked = 2;
        _;
        _locked = 1;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "FishAutoSwap: not owner");
        _;
    }

    modifier onlyKeeper() {
        require(msg.sender == keeper, "FishAutoSwap: not keeper");
        _;
    }

    event Registered(address indexed user, address targetToken, uint256 percentBps, uint256 dailyCap, uint256 slippageBps);
    event Disabled(address indexed user);
    event Executed(
        address indexed user,
        address targetToken,
        uint256 amountIn,
        uint256 amountOut,
        uint256 pathLength,
        uint256 timestamp
    );
    event KeeperChanged(address indexed oldKeeper, address indexed newKeeper);
    event PausedChanged(bool paused);

    constructor() {
        owner = msg.sender;
        keeper = msg.sender;
    }

    // ---- Owner: keeper + pause only. Owner cannot touch user funds or configs. ----
    function setKeeper(address newKeeper) external onlyOwner {
        require(newKeeper != address(0), "FishAutoSwap: keeper is zero address");
        emit KeeperChanged(keeper, newKeeper);
        keeper = newKeeper;
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedChanged(_paused);
    }

    // ---- User registration ----
    /// @notice Register (or update) your auto-swap settings and enable them.
    /// @param targetToken Token to swap into. address(0) or the 0xEeee..EEeE
    ///        sentinel both mean the native coin [42].
    /// @param percentBps Share of that day's minted FISH to swap (1..10000).
    /// @param dailyCap Hard cap on FISH swapped per day, in wei (> 0).
    /// @param slippageBps Max slippage vs. the on-chain quote at run time.
    function register(
        address targetToken,
        uint256 percentBps,
        uint256 dailyCap,
        uint256 slippageBps
    ) external {
        if (targetToken == NATIVE) targetToken = address(0);
        require(targetToken != address(FISH), "FishAutoSwap: target cannot be FISH");
        require(targetToken != address(this), "FishAutoSwap: target cannot be this contract");
        require(percentBps >= 1 && percentBps <= BPS, "FishAutoSwap: percentBps out of range");
        require(dailyCap > 0, "FishAutoSwap: dailyCap is zero");
        require(slippageBps <= MAX_SLIPPAGE_BPS, "FishAutoSwap: slippageBps too high");

        _configs[msg.sender] = Config({
            targetToken: targetToken,
            percentBps: percentBps,
            dailyCap: dailyCap,
            slippageBps: slippageBps,
            enabled: true,
            registered: true
        });
        if (!_inUsers[msg.sender]) {
            _inUsers[msg.sender] = true;
            _users.push(msg.sender);
        }
        emit Registered(msg.sender, targetToken, percentBps, dailyCap, slippageBps);
    }

    /// @notice Turn auto-swap off. Your config is kept; register() re-enables.
    ///         To also block all future transfers, revoke the FISH allowance
    ///         (approve 0) from your wallet.
    function disable() external {
        _configs[msg.sender].enabled = false;
        emit Disabled(msg.sender);
    }

    // ---- Views ----
    function configOf(address user) external view returns (Config memory) {
        return _configs[user];
    }

    function usersCount() external view returns (uint256) {
        return _users.length;
    }

    function userAt(uint256 index) external view returns (address) {
        return _users[index];
    }

    /// @notice True when the user has already been executed on the current UTC day.
    function executedToday(address user) external view returns (bool) {
        return _configs[user].registered && lastExecutedDay[user] == block.timestamp / 86400;
    }

    // ---- Keeper execution ----
    /// @notice Swap today's minted FISH for `user` into their registered target.
    /// @param user The registered user.
    /// @param grossMintToday Total FISH minted to `user` so far today (UTC day),
    ///        measured by the keeper from Transfer logs (from == address(0)).
    /// @param path Swap path: [FISH, target] or [FISH, hop, target]. For a
    ///        native target the last element must be ROUTER.WETH().
    function execute(address user, uint256 grossMintToday, address[] calldata path)
        external
        onlyKeeper
        nonReentrant
    {
        require(!paused, "FishAutoSwap: paused");
        Config memory cfg = _configs[user];
        require(cfg.registered && cfg.enabled, "FishAutoSwap: user not enabled");
        uint256 today = block.timestamp / 86400;
        require(lastExecutedDay[user] != today, "FishAutoSwap: already executed today");

        uint256 amountIn = _amountIn(user, cfg, grossMintToday);
        require(amountIn > 0, "FishAutoSwap: nothing to swap");

        _validatePath(cfg.targetToken, path);

        uint256[] memory amounts = ROUTER.getAmountsOut(amountIn, path);
        uint256 amountOutMin = (amounts[amounts.length - 1] * (BPS - cfg.slippageBps)) / BPS;
        require(amountOutMin > 0, "FishAutoSwap: quote is zero");

        // Checks-effects-interactions: mark the day before moving funds.
        lastExecutedDay[user] = today;

        uint256 amountOut = _swap(user, cfg.targetToken, amountIn, amountOutMin, path);
        emit Executed(user, cfg.targetToken, amountIn, amountOut, path.length, block.timestamp);
    }

    /// @dev min(gross x percent, dailyCap, balance, allowance).
    function _amountIn(address user, Config memory cfg, uint256 grossMintToday)
        internal
        view
        returns (uint256 amountIn)
    {
        amountIn = (grossMintToday * cfg.percentBps) / BPS;
        if (amountIn > cfg.dailyCap) amountIn = cfg.dailyCap;
        uint256 bal = FISH.balanceOf(user);
        if (amountIn > bal) amountIn = bal;
        uint256 allow = FISH.allowance(user, address(this));
        if (amountIn > allow) amountIn = allow;
    }

    /// @dev Pull the user's FISH, approve the router for exactly amountIn,
    ///      and swap with proceeds going straight to the user.
    function _swap(
        address user,
        address targetToken,
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path
    ) internal returns (uint256 amountOut) {
        require(FISH.transferFrom(user, address(this), amountIn), "FishAutoSwap: transferFrom failed");
        require(FISH.approve(address(ROUTER), amountIn), "FishAutoSwap: approve failed");
        uint256[] memory result;
        if (targetToken == address(0)) {
            result = ROUTER.swapExactTokensForETH(amountIn, amountOutMin, path, user, block.timestamp + 600);
        } else {
            result = ROUTER.swapExactTokensForTokens(amountIn, amountOutMin, path, user, block.timestamp + 600);
        }
        // Clear any leftover router allowance (should be fully consumed).
        FISH.approve(address(ROUTER), 0);
        return result[result.length - 1];
    }

    function _validatePath(address targetToken, address[] calldata path) internal view {
        require(path.length == 2 || path.length == 3, "FishAutoSwap: path length must be 2 or 3");
        require(path[0] == address(FISH), "FishAutoSwap: path must start with FISH");
        address expectedLast = targetToken == address(0) ? ROUTER.WETH() : targetToken;
        require(path[path.length - 1] == expectedLast, "FishAutoSwap: path must end with target");
        for (uint256 i = 0; i + 1 < path.length; i++) {
            require(path[i] != path[i + 1], "FishAutoSwap: duplicate hop token");
            require(
                FACTORY.getPair(path[i], path[i + 1]) != address(0),
                "FishAutoSwap: pair does not exist"
            );
        }
    }
}
