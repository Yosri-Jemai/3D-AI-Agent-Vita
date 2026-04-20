package com.unity6.vita.controller;

import com.unity6.vita.dto.AuthDTO;
import com.unity6.vita.dto.ProfileDTO;
import com.unity6.vita.entity.Profile;
import com.unity6.vita.repository.ProfileRepository;
import com.unity6.vita.service.ProfileService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1")
public class ProfileController {

    private final ProfileService profileService;
    private final ProfileRepository profileRepository;
    private final PasswordEncoder passwordEncoder;

    @PostMapping("/register")
    public ResponseEntity<ProfileDTO> register(@RequestBody ProfileDTO profileDTO) {
        ProfileDTO registeredProfile = profileService.registerProfile(profileDTO);
        return ResponseEntity.status(HttpStatus.CREATED).body(registeredProfile);
    }

    @PostMapping("/admin/register")
    public ResponseEntity<ProfileDTO> registerAdmin(@RequestBody ProfileDTO profileDTO) {
        ProfileDTO registeredProfile = profileService.registerAdminProfile(profileDTO);
        return ResponseEntity.status(HttpStatus.CREATED).body(registeredProfile);
    }

    @GetMapping("/activate")
    public ResponseEntity<String> activateProfile(@RequestParam String token) {
        System.out.println("🔑 Activation token received: " + token);
        boolean isActivated = profileService.activateAccount(token);
        if (isActivated) {
            return ResponseEntity.ok("Profile Activated Successfully! You can now login.");
        }
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body("Profile Activation Failed - Invalid or expired token");
    }

    @PostMapping("/login")
    public ResponseEntity<Map<String, Object>> login(@RequestBody AuthDTO authDTO) {
        try {
            System.out.println("🔐 Login attempt for: " + authDTO.getEmail());

            // Vérifier si le compte existe
            var profileOpt = profileRepository.findByEmail(authDTO.getEmail());
            if (profileOpt.isEmpty()) {
                System.out.println("❌ Account not found: " + authDTO.getEmail());
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                        .body(Map.of("message", "Account not found"));
            }

            Profile profile = profileOpt.get();
            System.out.println("📧 Account found: " + profile.getEmail());
            System.out.println("✅ Is Active: " + profile.getIsActive());
            System.out.println("👔 Role: " + profile.getRole());

            // Vérifier si le compte est activé
            if (profile.getIsActive() == null || !profile.getIsActive()) {
                System.out.println("⚠️ Account not activated: " + authDTO.getEmail());
                return ResponseEntity.status(HttpStatus.FORBIDDEN)
                        .body(Map.of("message", "Account Not Active. Please check your email for activation link."));
            }

            // Authentifier et générer le token
            Map<String, Object> response = profileService.authenticateAndGenerateToken(authDTO);
            System.out.println("✅ Login successful for: " + authDTO.getEmail());
            return ResponseEntity.ok(response);

        } catch (Exception e) {
            System.err.println("❌ Login error: " + e.getMessage());
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("message", "Invalid email or password"));
        }
    }

    @GetMapping("/profiles")
    public ResponseEntity<List<ProfileDTO>> getAllProfiles() {
        List<ProfileDTO> profiles = profileService.getAllProfiles();
        return ResponseEntity.ok(profiles);
    }

    @GetMapping("/verify")
    public ResponseEntity<Map<String, Object>> verifyToken(@RequestHeader(value = "Authorization", required = false) String authHeader) {
        try {
            if (authHeader == null || !authHeader.startsWith("Bearer ")) {
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                        .body(Map.of("valid", false, "message", "No token provided"));
            }
            return ResponseEntity.ok(Map.of("valid", true, "message", "Token is valid"));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("valid", false, "message", "Invalid token"));
        }
    }

    @GetMapping("/auth-health")
    public ResponseEntity<Map<String, String>> authHealth() {
        return ResponseEntity.ok(Map.of(
                "status", "ok",
                "service", "VitalAgent Auth",
                "timestamp", String.valueOf(System.currentTimeMillis())
        ));
    }

    @GetMapping("/check-activation")
    public ResponseEntity<Map<String, Object>> checkActivation(@RequestParam String email) {
        var profileOpt = profileRepository.findByEmail(email);
        if (profileOpt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "Profile not found"));
        }

        Profile profile = profileOpt.get();
        return ResponseEntity.ok(Map.of(
                "email", profile.getEmail(),
                "isActive", profile.getIsActive(),
                "fullName", profile.getFullName(),
                "message", profile.getIsActive() ? "Account is active" : "Account is not active"
        ));
    }

    @GetMapping("/admin/dashboard-stats")
    public ResponseEntity<Map<String, Object>> dashboardStats() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        profileService.ensureAdminAccess(authentication.getName());
        return ResponseEntity.ok(profileService.getAdminDashboardStats());
    }

    @GetMapping("/admin/commercial-tracking")
    public ResponseEntity<Map<String, Object>> commercialTracking() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        profileService.ensureAdminAccess(authentication.getName());
        return ResponseEntity.ok(profileService.getCommercialTrackingStats());
    }
}