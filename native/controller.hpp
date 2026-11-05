#pragma once
#include "discovery.hpp"

namespace dsh {
class Controller {
    Assets assets_;
    std::optional<Host> host_;
    Json candidate_, location_;
    bool inspect_{};
    Host host();
    Json present(Json state);
    Json discover(Cdp& client, const Host& host, bool force);
public:
    const Assets& assets() const { return assets_; }
    Json status();
    Json discover();
    Json apply(const Persona& persona);
    Json reset();
    Json selfTest();
    Json fixtureTest(const Host& fixture);
};
}
