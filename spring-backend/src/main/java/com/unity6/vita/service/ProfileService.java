package com.unity6.vita.service;

import com.unity6.vita.dto.AuthDTO;
import com.unity6.vita.dto.ProfileDTO;
import com.unity6.vita.entity.Profile;
import com.unity6.vita.repository.ProfileRepository;
import com.unity6.vita.util.JwtUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class ProfileService {

    private final ProfileRepository profileRepository;
    private final EmailService emailService;
    private final PasswordEncoder passwordEncoder;
    private final AuthenticationManager authenticationManager;
    private final JwtUtil jwtUtil;

    public Profile toEntity(ProfileDTO profileDTO) {
        return Profile.builder()
                .id(profileDTO.getId())
                .fullName(profileDTO.getFullName())
                .email(profileDTO.getEmail())
                .password(passwordEncoder.encode(profileDTO.getPassword()))
                .profileImageUrl(profileDTO.getProfileImageUrl())
                .numTelephone(profileDTO.getNumTelephone())
                .role(profileDTO.getRole())
                .createdAt(profileDTO.getCreatedAt())
                .build();
    }

    public ProfileDTO toDTO(Profile profile) {
        return ProfileDTO.builder()
                .id(profile.getId())
                .fullName(profile.getFullName())
                .email(profile.getEmail())
                .password(profile.getPassword())
                .numTelephone(profile.getNumTelephone())
                .profileImageUrl(profile.getProfileImageUrl())
                .role(profile.getRole())
                .createdAt(profile.getCreatedAt())
                .build();
    }

    public ProfileDTO registerProfile(ProfileDTO profileDTO) {
        Profile newProfile = toEntity(profileDTO);
        String activationToken = UUID.randomUUID().toString();
        newProfile.setActivationToken(activationToken);
        newProfile.setIsActive(false); // Explicitly set to false

        Profile savedProfile = profileRepository.save(newProfile);
        System.out.println("✅ Profile registered: " + savedProfile.getEmail());
        System.out.println("🔑 Activation token: " + activationToken);

        // Correct activation link with /api/v1
        String activationLink = "http://localhost:8080/api/v1/activate?token=" + activationToken;
        String subject = "Activez votre compte VitalAgent";
        String body = "Bonjour " + savedProfile.getFullName() + ",\n\n" +
                "Cliquez sur le lien suivant pour activer votre compte VitalAgent :\n\n" +
                activationLink + "\n\n" +
                "Ce lien expire dans 24 heures.\n\n" +
                "Cordialement,\n" +
                "L'équipe VitalAgent";

        try {
            emailService.sendEmail(savedProfile.getEmail(), subject, body);
            System.out.println("📧 Activation email sent to: " + savedProfile.getEmail());
        } catch (Exception e) {
            System.err.println("❌ Failed to send email: " + e.getMessage());
        }

        return toDTO(savedProfile);
    }

    public boolean activateAccount(String activationToken) {
        System.out.println("🔑 Activating account with token: " + activationToken);

        return profileRepository.findByActivationToken(activationToken)
                .map(profile -> {
                    System.out.println("📧 Found profile: " + profile.getEmail());
                    System.out.println("Current isActive: " + profile.getIsActive());

                    profile.setIsActive(true);
                    profile.setActivationToken(null); // Clear the token after activation
                    Profile saved = profileRepository.save(profile);

                    System.out.println("✅ After save - isActive: " + saved.getIsActive());
                    return true;
                }).orElse(false);
    }

    public boolean isAccountActive(String email) {
        return profileRepository.findByEmail(email)
                .map(profile -> {
                    Boolean isActive = profile.getIsActive();
                    System.out.println("Checking account: " + email + " - isActive: " + isActive);
                    return isActive != null && isActive;
                })
                .orElse(false);
    }

    public Profile getCurrentProfile() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        return profileRepository.findByEmail(authentication.getName())
                .orElseThrow(() -> new UsernameNotFoundException("User not found with email: " + authentication.getName()));
    }

    public ProfileDTO getPublicProfile(String email) {
        if(email == null) {
            return toDTO(getCurrentProfile());
        } else {
            return toDTO(profileRepository.findByEmail(email)
                    .orElseThrow(() -> new UsernameNotFoundException("User not found with email: " + email)));
        }
    }

    public Map<String, Object> authenticateAndGenerateToken(AuthDTO authDTO) {
        try {
            System.out.println("🔐 Authenticating user: " + authDTO.getEmail());

            authenticationManager.authenticate(
                    new UsernamePasswordAuthenticationToken(authDTO.getEmail(), authDTO.getPassword())
            );

            String token = jwtUtil.generateToken(authDTO.getEmail());
            System.out.println("🎫 Token generated for: " + authDTO.getEmail());

            return Map.of(
                    "token", token,
                    "user", getPublicProfile(authDTO.getEmail())
            );
        } catch (Exception e) {
            System.err.println("❌ Authentication failed: " + e.getMessage());
            throw new UsernameNotFoundException("Invalid email or password");
        }
    }

    public List<ProfileDTO> getAllProfiles() {
        List<Profile> profiles = profileRepository.findAll();
        return profiles.stream()
                .map(this::toDTO)
                .collect(Collectors.toList());
    }

    public Profile getProfileById(Long id) {
        return profileRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Profile not found with id: " + id));
    }
}